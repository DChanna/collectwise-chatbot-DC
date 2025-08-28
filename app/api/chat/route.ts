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
  
  // Process uploaded documents with GPT Vision
  let documentAnalysis = '';
  let documentApproved = false;

  try {
    
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
- ALWAYS allow shorter terms (1-8 months) - users should be encouraged to pay faster
- For $1000 income: Start with 8-9 months, but accept ANY shorter term without question
- Maximum 12 months WITHOUT documentation
- Maximum 24 months ONLY with proper documentation of hardship
- Before offering terms over 12 months, REQUIRE documentation
- Progression: ANY short term (1-8) → 9-12 months → 13-24 months (ONLY with documentation)

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
  collectwise.com/payments?termLength={months}&totalDebtAmount={totalDebt}&termPaymentAmount={cents}&finalPaymentAmount={finalCents}
- termPaymentAmount and finalPaymentAmount must be in CENTS (multiply dollars by 100)
- For 7 months: termPaymentAmount=34285&finalPaymentAmount=34290 (not 34286)
- Include "Here's your secure payment link to get started:" before the URL
- NEVER use decimal amounts in URLs

PAYMENT CALCULATION RULES:
- CRITICAL: For imperfect divisions (like $2400/7 months), NEVER use simple division
- ALWAYS use this method: Base payment = floor(debt/months), Final payment = remaining amount
- Example: 7 months = $342.85 × 6 months + $342.90 final month = $2400 exactly
- NEVER say "$342.86 per month" for 7 months (that totals $2401, not $2400)
- ALWAYS show breakdown: "Monthly Payment: $X.XX × N months, Final Payment: $Y.YY"
- Maximum 12 months WITHOUT documentation, 24 months WITH documentation
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

      // If this is a document analysis request, use the analysis result instead
      if (documentAnalysis && (message.toLowerCase().includes('uploaded') || message.toLowerCase().includes('documentation') || message.toLowerCase().includes('review'))) {
        response = documentAnalysis;
      }

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
          
          // ALWAYS recalculate with our bulletproof method
          const exactPayment = totalDebt / termLength;
          const basePayment = Math.floor(exactPayment * 100) / 100;
          const finalPayment = totalDebt - (basePayment * (termLength - 1));
          const hasVariation = Math.abs(finalPayment - basePayment) > 0.01;
          
          // Ensure URL has correct format with cents (no decimals)
          const correctUrl = hasVariation 
            ? `collectwise.com/payments?termLength=${termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${Math.round(basePayment * 100)}&finalPaymentAmount=${Math.round(finalPayment * 100)}`
            : `collectwise.com/payments?termLength=${termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${Math.round(basePayment * 100)}&finalPaymentAmount=${Math.round(basePayment * 100)}`;
          
          // Also fix the response text if it has incorrect calculations
          if (hasVariation) {
            // Replace any mention of simple division with proper breakdown
            response = response.replace(/\$[\d,]+\.?\d* per month/g, `$${basePayment.toFixed(2)} per month for ${termLength - 1} months, then $${finalPayment.toFixed(2)} for the final month`);
            response = response.replace(/\$[\d,]+\.?\d* ÷ \d+ = \$[\d,]+\.?\d* per month/g, `Payment breakdown: $${basePayment.toFixed(2)} × ${termLength - 1} months + $${finalPayment.toFixed(2)} final = $${totalDebt.toFixed(2)}`);
          }
          
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
    // If we have document analysis, prioritize that over generic fallback
    let fallbackResponse;
    if (documentAnalysis && (message.toLowerCase().includes('uploaded') || message.toLowerCase().includes('documentation') || message.toLowerCase().includes('review'))) {
      fallbackResponse = documentAnalysis;
    } else {
      fallbackResponse = generateFallbackResponse(message, totalDebt, uploadedFiles);
    }
    
    const hasPaymentURL = fallbackResponse.includes('collectwise.com/payments');
    
    return NextResponse.json({ 
      response: fallbackResponse,
      agreementReached: hasPaymentURL,
      documentApproved,
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
         message: `Thank you for providing documentation.\n\nAfter reviewing your documents, I can confirm they verify ${hardshipType.trim()}. Based on this verified hardship, I can now offer extended payment terms up to 24 months.\n\nLet me suggest some options:\n- 18 months: $133 per month\n- 20 months: $120 per month  \n- 24 months: $100 per month\n\nWhich option works best for your budget?`,
         approved: true
       };
     } else {
       const documentType = analysis.match(/REJECTED:\s*(.+)/i)?.[1] || "document";
       return {
         message: `Thank you for uploading your documentation.\n\nAfter reviewing your ${documentType.toLowerCase()}, it doesn't demonstrate the type of financial hardship that qualifies for extended terms beyond 12 months.\n\nHowever, I can still offer these standard options:\n- 8 months: $300 per month\n- 10 months: $240 per month\n- 12 months: $200 per month\n\nWhich payment plan works for your budget?`,
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
  
  // Helper function to calculate payments with bulletproof math
  const calculatePayment = (termLength: number) => {
    const exactPayment = totalDebt / termLength;
    let basePayment = Math.floor(exactPayment * 100) / 100; // Round DOWN to avoid overage
    let finalPayment = totalDebt - (basePayment * (termLength - 1));
    
    // Ensure final payment is reasonable (not negative or too large)
    if (finalPayment < 0 || finalPayment > basePayment * 2) {
      // If final payment is problematic, use simple rounding
      basePayment = Math.round(exactPayment * 100) / 100;
      finalPayment = basePayment;
    }
    
    const hasVariation = Math.abs(finalPayment - basePayment) > 0.01;
    
    // ALWAYS validate the math
    const calculatedTotal = hasVariation 
      ? (basePayment * (termLength - 1)) + finalPayment
      : basePayment * termLength;
    
    // Log any discrepancies for debugging
    if (Math.abs(calculatedTotal - totalDebt) > 0.005) {
      console.error(`Math error: ${calculatedTotal} !== ${totalDebt} for ${termLength} months`);
    }
    
    return {
      amount: basePayment,
      finalPayment: finalPayment,
      termLength,
      hasVariation,
      description: hasVariation 
        ? `$${basePayment.toFixed(2)} per month for ${termLength - 1} months, then $${finalPayment.toFixed(2)} for the final month`
        : `$${basePayment.toFixed(2)} per month for ${termLength} months`,
      breakdown: hasVariation
        ? `\n\nPayment Breakdown:\n- Monthly Payment: $${basePayment.toFixed(2)} × ${termLength - 1} months = $${(basePayment * (termLength - 1)).toFixed(2)}\n- Final Payment: $${finalPayment.toFixed(2)} × 1 month = $${finalPayment.toFixed(2)}\n- Total: $${totalDebt.toFixed(2)}`
        : `\n\nPayment Breakdown:\n- Monthly Payment: $${basePayment.toFixed(2)} × ${termLength} months = $${totalDebt.toFixed(2)}\n- Total: $${totalDebt.toFixed(2)}`
    };
  };
  
  const docAcknowledgment = hasDocumentation 
    ? `Thank you for providing your documentation (${uploadedFiles!.map(f => f.name).join(', ')}).\n\nBased on your submitted documents, ` 
    : '';
  
  if (lowerMessage.includes('yes') || lowerMessage.includes('works') || lowerMessage.includes('good') || lowerMessage.includes('sure')) {
    // Use reasonable fallback based on documentation status
    const payment = calculatePayment(hasDocumentation ? 18 : 12);
    const linkPaymentAmount = payment.hasVariation ? payment.amount : payment.amount;
    return `Perfect! ${docAcknowledgment}I'm glad we found something that works for you.\n\nFor a ${payment.termLength}-month payment plan on a debt of $${totalDebt.toFixed(2)}, here's the breakdown:\n\n${payment.description}${payment.breakdown}\n\nHere's your secure payment link to get started:\ncollectwise.com/payments?termLength=${payment.termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${Math.round(linkPaymentAmount * 100)}&finalPaymentAmount=${payment.hasVariation ? Math.round(payment.finalPayment * 100) : Math.round(linkPaymentAmount * 100)}`;
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
  
  // Handle specific term requests
  if (lowerMessage.includes('month') && userMessage.match(/\d+/)) {
    const suggestedMonths = parseInt(userMessage.match(/\d+/)![0]);
    
    // ALWAYS allow ANY shorter terms (user wants to pay faster)
    if (suggestedMonths >= 1 && suggestedMonths <= 24) {
      // For short terms (1-8), always approve immediately
      if (suggestedMonths <= 8) {
        const payment = calculatePayment(suggestedMonths);
        const linkPaymentAmount = payment.hasVariation ? payment.amount : payment.amount;
        return `Excellent! I appreciate you wanting to resolve this quickly.\n\n${docAcknowledgment}For a ${payment.termLength}-month payment plan on a debt of $${totalDebt.toFixed(2)}, here's the breakdown:\n\n${payment.description}${payment.breakdown}\n\nHere's your secure payment link to get started:\ncollectwise.com/payments?termLength=${payment.termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${Math.round(linkPaymentAmount * 100)}&finalPaymentAmount=${payment.hasVariation ? Math.round(payment.finalPayment * 100) : Math.round(linkPaymentAmount * 100)}`;
      }
      
      // For medium terms (9-12), check if it's reasonable
      if (suggestedMonths <= 12) {
        const payment = calculatePayment(suggestedMonths);
        const linkPaymentAmount = payment.hasVariation ? payment.amount : payment.amount;
        return `I can work with that plan.\n\n${docAcknowledgment}For a ${payment.termLength}-month payment plan on a debt of $${totalDebt.toFixed(2)}, here's the breakdown:\n\n${payment.description}${payment.breakdown}\n\nHere's your secure payment link to get started:\ncollectwise.com/payments?termLength=${payment.termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${Math.round(linkPaymentAmount * 100)}&finalPaymentAmount=${payment.hasVariation ? Math.round(payment.finalPayment * 100) : Math.round(linkPaymentAmount * 100)}`;
      }
      
      // For longer terms (13-24), require documentation
      if (suggestedMonths > 12 && !hasDocumentation) {
        const counterPayment = calculatePayment(12);
        return `I understand you'd prefer lower payments, but ${suggestedMonths} months would require documentation of financial hardship.\n\n${docAcknowledgment}Without documentation, the maximum term I can offer is ${counterPayment.description}.\n\nIf you're experiencing job loss, medical expenses, or other hardship, please upload supporting documentation for longer terms.`;
      }
      
      // With documentation, allow up to 24 months
      if (suggestedMonths <= 24 && hasDocumentation) {
        const payment = calculatePayment(suggestedMonths);
        const linkPaymentAmount = payment.hasVariation ? payment.amount : payment.amount;
        return `I can work with that plan.\n\n${docAcknowledgment}For a ${payment.termLength}-month payment plan on a debt of $${totalDebt.toFixed(2)}, here's the breakdown:\n\n${payment.description}${payment.breakdown}\n\nHere's your secure payment link to get started:\ncollectwise.com/payments?termLength=${payment.termLength}&totalDebtAmount=${totalDebt}&termPaymentAmount=${Math.round(linkPaymentAmount * 100)}&finalPaymentAmount=${payment.hasVariation ? Math.round(payment.finalPayment * 100) : Math.round(linkPaymentAmount * 100)}`;
      }
    }
    
    // Handle extreme cases
    if (suggestedMonths > 24) {
      const counterPayment = calculatePayment(hasDocumentation ? 24 : 12);
      return `I understand you'd prefer lower payments, but ${suggestedMonths} months is beyond what we can offer.\n\n${docAcknowledgment}The maximum term I can offer is ${counterPayment.description}.\n\nWould this work for you?`;
    }
  }
  
  // Default: Start with aggressive shortest viable term (8-9 months for $1000 income)
  const payment = calculatePayment(8);
  return `I want to work with you on this.\n\n${docAcknowledgment}Let's start with ${payment.description} - this gets it resolved efficiently.\n\nIf that's too high for your budget, let me know and we can discuss other options.`;
}