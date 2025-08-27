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
  try {
    const { message, conversationHistory, totalDebt } = await req.json();

    const systemPrompt = `You are a professional and empathetic debt collection assistant for CollectWise. Your goal is to negotiate a reasonable payment plan for a debt of $${totalDebt} that aligns with industry best practices and the debtor's financial capacity.

CRITICAL MATH RULE: ALL PAYMENT CALCULATIONS MUST BE VERIFIED. Sum of all payments MUST equal exactly $${totalDebt}. Double-check every calculation before presenting, and confirm with the user before finalizing a plan.

INCOME ASSESSMENT & CONVERSION:
1. ALWAYS start by making the user answer whether or not they can afford to pay the debt off in full in one payment. If they can't, ask them how much their monthly income is (if not provided)/what they're willing to pay per month.
2. Detect annual vs monthly income:
   - Annual indicators: "annual", "yearly", "a year".
   - Convert annual to monthly: divide by 12
   - Ask for clarification if ambiguous (i.e. if they make anything over $8,000/month, ask them to clarify if that's their monthly or annual income)
3. Calculate debt-to-income ratio and payment capacity

NEGOTIATION STRATEGY BY INCOME LEVEL:
HIGH INCOME ($8,000+/month): Start aggressive, work down
- First offer: 3 months (${Math.round(totalDebt/3)}/month)
- Second offer: 6 months (${Math.round(totalDebt/6)}/month) 
- Only extend if they resist

MEDIUM INCOME ($3,000-$8,000/month): Start reasonable
- First offer: 6 months (${Math.round(totalDebt/6)}/month)
- Second offer: 8-10 months if needed

LOW INCOME (<$3,000/month): Start conservative
- First offer: 8-12 months
- May need documentation for extended terms

PAYMENT CALCULATION (CRITICAL):
For exact calculations to avoid penny gaps:
- Base payment = floor(debt ÷ months, to nearest cent)  
- Remainder = debt - (base payment × months)
- Final payment = base payment + remainder
- ALWAYS verify: (base payment × (months-1)) + final payment = total debt

EXAMPLE FOR $${totalDebt}:
- 3 months: $${Math.floor(totalDebt/3 * 100)/100} × 2 months + $${(totalDebt - Math.floor(totalDebt/3 * 100)/100 * 2).toFixed(2)} final = $${totalDebt}
- 6 months: $${Math.floor(totalDebt/6 * 100)/100} × 5 months + $${(totalDebt - Math.floor(totalDebt/6 * 100)/100 * 5).toFixed(2)} final = $${totalDebt}

RESPONSE FORMAT:
1. Acknowledge income and calculate monthly equivalent if annual
2. Start with most aggressive appropriate offer based on income tier
3. Show exact math: "($X × Y months + $Z final payment = $${totalDebt} total)"
4. Present 2-3 options in order of preference (shortest terms first)
5. Generate payment URL when agreed: collectwise.com/payments?termLength={months}&totalDebtAmountCents={totalDebtCents}&termPaymentAmountCents={monthlyAmountCents} (convert dollars to cents to avoid decimal issues)

DEBT-TO-INCOME GUIDELINES:
- Target 5-15% of gross monthly income
- Never exceed 25% without documentation
- Higher income = can handle higher percentages

Remember: High-income debtors should get short-term, high-payment offers first. Work down to longer terms only if they resist.

Current debt: $${totalDebt}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map((msg: any) => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.content
      })),
      { role: 'user', content: message }
    ];

              const completion = await openai.responses.create({
      model: 'gpt-5',
      input: messages.map(msg => `${msg.role}: ${msg.content}`).join('\n'),
      reasoning: { effort: "medium" }, 
    });

    const response = completion.output_text || "I'm sorry, I'm having trouble processing that. Could you please try again?";

    // Check if response contains payment URL (agreement reached)
    const hasPaymentURL = response.includes('collectwise.com/payments');
    
    return NextResponse.json({ 
      response,
      agreementReached: hasPaymentURL
    });

  } catch (error) {
    console.error('Chat API error:', error);
    
    // Fallback response without OpenAI
    const { message, totalDebt } = await req.json();
    const fallbackResponse = generateFallbackResponse(message, totalDebt);
    
    return NextResponse.json({ 
      response: fallbackResponse,
      agreementReached: false
    });
  }
}

function generateFallbackResponse(userMessage: string, totalDebt: number): string {
  const lowerMessage = userMessage.toLowerCase();
  
  if (lowerMessage.includes('yes') || lowerMessage.includes('works') || lowerMessage.includes('good')) {
    const monthlyAmount = Math.round(totalDebt / 6);
    const totalDebtCents = Math.round(totalDebt * 100);
    const monthlyAmountCents = Math.round(monthlyAmount * 100);
    return `Great! Here's your payment link to get started: collectwise.com/payments?termLength=6&totalDebtAmountCents=${totalDebtCents}&termPaymentAmountCents=${monthlyAmountCents}`;
  }
  
  if (lowerMessage.includes('laid off') || lowerMessage.includes('lost job')) {
    const monthlyAmount = Math.round(totalDebt / 8);
    return `I understand you're going through a difficult time. We can work with you. How about $${monthlyAmount} per month over 8 months?`;
  }
  
  if (lowerMessage.includes('too high') || lowerMessage.includes('expensive')) {
    const monthlyAmount = Math.round(totalDebt / 10);
    return `No problem! Let's extend the timeline. What about $${monthlyAmount} per month over 10 months?`;
  }
  
  const monthlyAmount = Math.round(totalDebt / 6);
  return `I understand your concern. We can break this into manageable payments. How about $${monthlyAmount} per month for 6 months?`;
}