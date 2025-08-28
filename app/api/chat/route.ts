import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface PaymentNegotiation {
  totalDebt: number;
  proposedAmount?: number;
  termLength?: number;
  conversationHistory: string[];
}

export async function POST(req: NextRequest) {
  // Read the request body once at the start
  const { message, conversationHistory, totalDebt, uploadedFiles } = await req.json();
  
  try {
    // Process uploaded documents with GPT Vision
    let documentAnalysis = '';
    let documentApproved = false;
    
    if (uploadedFiles && uploadedFiles.length > 0) {
      const imageFiles = uploadedFiles.filter((file: any) => 
        file.type?.startsWith('image/') || file.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i)
      );
      
      if (imageFiles.length > 0) {
        const analysisResult = await analyzeDocuments(imageFiles);
        documentAnalysis = analysisResult.message;
        documentApproved = analysisResult.approved;
      }
    }

    const systemPrompt = `You are a compassionate and professional debt collection assistant for CollectWise. Your role is to help people find manageable payment solutions for their debt of $${totalDebt}.

CRITICAL: ALWAYS respond directly to what the user actually said. Do not ignore their input or give unsolicited advice.

CONVERSATION FLOW:
1. FIRST: Ask if they can pay the full amount today
2. If NO: Ask for monthly income information  
3. ONLY THEN: Suggest reasonable payment plans based on their income
4. Be responsive to their actual questions and statements

NEGOTIATION STRATEGY:
- START with shortest viable term that keeps payments within 20% of income
- For $1000 income: Start with 8-9 months ($300-$267), only offer longer when they negotiate
- Maximum 12 months WITHOUT documentation
- Maximum 24 months ONLY with proper documentation of hardship
- Before offering terms over 12 months, REQUIRE documentation
- Progression: 8-9 months → 10-12 months → 13-24 months (ONLY with documentation)

COMMUNICATION STYLE:
- Be warm, understanding, and genuinely empathetic
- Respond directly to what they said
- Use natural conversation flow with proper line breaks between ideas
- Structure responses: Acknowledgment → [Line break] → Question/Option → [Line break] → Follow-up
- Never ignore user input or change topics abruptly

RESPONSE FORMAT:
- Use line breaks (\n\n) between different concepts
- Keep sentences clear and well-spaced
- Avoid run-on responses without breaks

INCOME HANDLING:
- For ambiguous amounts (like "25K" or amounts over $1000), ALWAYS ask if it's monthly or annual
- Never assume annual or monthly without clarification
- Only proceed with payment calculations after income is confirmed

SCOPE LIMITATIONS:
- ONLY focus on: debt amount, payment terms, monthly amount, term length
- DO NOT ask for: payment methods, personal details, address, phone, etc.
- Once terms are agreed, provide payment link immediately
- Do not request additional information beyond payment plan details

PAYMENT LINK FORMAT:
- ALWAYS use exactly this format when agreement is reached:
  collectwise.com/payments?termLength={months}&totalDebtAmount=${totalDebt}&termPaymentAmount={monthlyAmount}
- Include "Here's your secure payment link to get started:" before the URL
- Make sure to calculate the exact monthly payment amount

PAYMENT CALCULATION RULES:
- ALWAYS verify calculations are accurate before responding
- NEVER offer terms longer than 12 months WITHOUT documentation
- Maximum 24-36 months ONLY with proper hardship documentation
- Target 10-20% of monthly income for payments
- If debt doesn't divide evenly, round to nearest cent and note final payment adjustment
- REJECT any user requests for terms over 12 months without documentation

Current debt: $${totalDebt}

${documentApproved ? `
DOCUMENT STATUS: ✓ APPROVED - The user has provided valid financial hardship documentation. You may now offer extended payment terms up to 24 months.` : ''}

${uploadedFiles && uploadedFiles.length > 0 && !documentApproved ? `
DOCUMENT STATUS: ✗ REJECTED - The uploaded documents do not demonstrate qualifying financial hardship. Maximum term remains 12 months without valid documentation.` : ''}

${documentAnalysis ? `\nDOCUMENT ANALYSIS: ${documentAnalysis}` : ''}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map((msg: any) => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.content
      })),
      { role: 'user', content: message }
    ];

    // Increase timeout to 10 seconds to prevent premature fallback
    const apiTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('API timeout')), 10000)
    );

    const apiCall = openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    const completion = await Promise.race([apiCall, apiTimeout]) as any;

    let response = completion.choices?.[0]?.message?.content || "I'm sorry, I'm having trouble processing that. Could you please try again?";

    // Fix payment URL format if it exists but is malformed
    const urlRegex = /collectwise\.com\/payments\?[^\s]*/g;
    const urlMatch = response.match(urlRegex);
    
    if (urlMatch) {
      // Extract parameters from the URL if they exist
      const termMatch = response.match(/termLength=(\d+)/);
      const monthlyMatch = response.match(/termPaymentAmount=([\d.]+|NaN)/);
      
      if (termMatch) {
        const termLength = parseInt(termMatch[1]);
        let monthlyPayment: number;
        
        // Check if payment amount is NaN or missing
        if (!monthlyMatch || monthlyMatch[1] === 'NaN' || isNaN(parseFloat(monthlyMatch[1]))) {
          // Calculate the correct monthly payment
          monthlyPayment = Math.round((totalDebt / termLength) * 100) / 100;
        } else {
          monthlyPayment = parseFloat(monthlyMatch[1]);
        }
        
        // Ensure URL has correct format with valid payment amount
        const correctUrl = `collectwise.com/payments?termLength=${termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${monthlyPayment}`;
        response = response.replace(urlRegex, correctUrl);
      }
    }

    // Check if response contains payment URL (agreement reached)
    const hasPaymentURL = response.includes('collectwise.com/payments');
    
    return NextResponse.json({ 
      response,
      agreementReached: hasPaymentURL,
      documentApproved
    });

  } catch (error) {
    console.error('Chat API error:', error);
    
    // Use the already-read request data for fallback
    const fallbackResponse = generateFallbackResponse(message, totalDebt, uploadedFiles);
    
    const hasPaymentURL = fallbackResponse.includes('collectwise.com/payments');
    
    return NextResponse.json({ 
      response: fallbackResponse,
      agreementReached: hasPaymentURL,
      paymentUrl: hasPaymentURL ? fallbackResponse.match(/https:\/\/collectwise\.com\/payments\?[^\s]+/)?.[0] : null
    });
  }
}

async function analyzeDocuments(imageFiles: any[]): Promise<{ message: string; approved: boolean }> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const imageContent = imageFiles
      .filter(file => file.type?.startsWith('image/') || file.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i))
      .map(file => ({
        type: "image_url" as const,
        image_url: {
          url: file.dataUrl || `data:${file.type};base64,${file.base64}`
        }
      }));

    if (imageContent.length === 0) {
      return { 
        message: `Received ${imageFiles.length} document(s) for review.`,
        approved: false
      };
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are analyzing documents for a debt collection payment plan. You must be STRICT about what qualifies as valid financial hardship.

VALID HARDSHIP EVIDENCE (APPROVE ONLY THESE):
✓ Unemployment benefits statements showing payments
✓ Termination/layoff letters from employer
✓ Medical bills over $500
✓ Pay stubs showing income reduction of 30% or more
✓ Bank statements showing unemployment/disability deposits
✓ Official disability documentation
✓ Eviction notices or foreclosure documents
✓ Court documents showing bankruptcy filing

INVALID - REJECT THESE:
✗ Insurance cards (health, auto, dental, vision)
✗ Credit cards or credit card statements
✗ Regular utility bills
✗ Driver's license or ID cards
✗ Regular employment documents without showing hardship
✗ Normal pay stubs without income reduction
✗ Membership cards
✗ Regular bank statements without hardship evidence

Analyze the document and respond with EXACTLY one of these two formats:
"APPROVED: [specific hardship type identified]"
OR
"REJECTED: [what the document actually is]"

Be very strict - only approve documents that clearly demonstrate financial hardship.`
            },
            ...imageContent
          ]
        }
      ],
      max_tokens: 100
    });

    const analysis = completion.choices[0]?.message?.content || "REJECTED: Unable to analyze document";
    
    const isApproved = analysis.toUpperCase().startsWith('APPROVED');
    
    if (isApproved) {
      const hardshipType = analysis.match(/APPROVED:\s*(.+)/i)?.[1] || "financial hardship";
      return {
        message: `Documents verify ${hardshipType.trim()}. Extended payment terms up to 24 months are now authorized.`,
        approved: true
      };
    } else {
      const documentType = analysis.match(/REJECTED:\s*(.+)/i)?.[1] || "document";
      return {
        message: `The uploaded ${documentType.toLowerCase()} does not demonstrate qualifying financial hardship. Payment terms remain limited to 12 months maximum without valid hardship documentation.`,
        approved: false
      };
    }

  } catch (error) {
    console.error('Document analysis error:', error);
    return {
      message: `Unable to properly analyze the uploaded documentation at this time.`,
      approved: false
    };
  }
}

function generateFallbackResponse(userMessage: string, totalDebt: number, uploadedFiles?: any[]): string {
  const lowerMessage = userMessage.toLowerCase();
  const hasDocumentation = uploadedFiles && uploadedFiles.length > 0;
  
  // Helper function to calculate payments with proper validation
  const calculatePayment = (termLength: number) => {
    const exactPayment = totalDebt / termLength;
    const roundedPayment = Math.round(exactPayment * 100) / 100; // Round to nearest cent
    const totalWithRounded = roundedPayment * termLength;
    const difference = Math.abs(totalWithRounded - totalDebt);
    
    // If difference is significant, note that payments may vary slightly
    const hasVariation = difference > 0.01;
    
    return {
      amount: roundedPayment,
      termLength,
      hasVariation,
      description: hasVariation 
        ? `$${roundedPayment.toFixed(2)} per month for ${termLength} months (final payment may vary slightly to cover the exact total)`
        : `$${roundedPayment.toFixed(2)} per month for ${termLength} months`
    };
  };
  
  const docAcknowledgment = hasDocumentation 
    ? `Thank you for providing your documentation (${uploadedFiles!.map(f => f.name).join(', ')}).\n\nBased on your submitted documents, ` 
    : '';
  
  if (lowerMessage.includes('yes') || lowerMessage.includes('works') || lowerMessage.includes('good') || lowerMessage.includes('sure')) {
    // Use reasonable fallback based on documentation status
    const payment = calculatePayment(hasDocumentation ? 18 : 12);
    return `Perfect! ${docAcknowledgment}I'm glad we found something that works for you.\n\nHere's your secure payment link to get started:\ncollectwise.com/payments?termLength=${payment.termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${payment.amount}`;
  }
  
  if (lowerMessage.includes('laid off') || lowerMessage.includes('lost job') || lowerMessage.includes('unemployed')) {
    const termLength = hasDocumentation ? 12 : 8;
    const payment = calculatePayment(termLength);
    return `I really understand how challenging job loss can be, and I want to work with you during this difficult time.\n\n${docAcknowledgment}How about ${payment.description}?\n\nFor this extended plan, I'll need to see some recent documentation of your situation (unemployment benefits, job search records, etc.). Does this feel manageable for your current situation?`;
  }
  
  if (lowerMessage.includes('too high') || lowerMessage.includes('expensive') || lowerMessage.includes('can\'t afford')) {
    if (!hasDocumentation) {
      // First negotiation step: offer 10-12 month range
      const payment = calculatePayment(10);
      return `I completely understand that affordability is important.\n\n${docAcknowledgment}Let me try a longer timeline: ${payment.description}.\n\nWould this work better for your budget?`;
    } else {
      const payment = calculatePayment(18);
      return `I completely understand that affordability is important.\n\n${docAcknowledgment}Based on your documentation, I can offer: ${payment.description}.\n\nWould this work better for your budget?`;
    }
  }
  
  // Default: Start with aggressive shortest viable term (8-9 months for $1000 income)
  const payment = calculatePayment(8);
  return `I want to work with you on this.\n\n${docAcknowledgment}Let's start with ${payment.description} - this gets it resolved efficiently.\n\nIf that's too high for your budget, let me know and we can discuss other options.`;
}