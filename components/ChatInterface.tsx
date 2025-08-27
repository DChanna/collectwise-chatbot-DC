import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, DollarSign, CheckCircle, AlertCircle, FileText } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  sender: 'bot' | 'user';
  timestamp: Date;
  isError?: boolean;
}

interface PaymentPlan {
  totalDebt: number;
  termLength: number;
  monthlyPayment: number;
  frequency: 'monthly' | 'biweekly' | 'weekly';
}

const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentDebt] = useState(2400);
  const [negotiationState, setNegotiationState] = useState<'initial' | 'negotiating' | 'completed'>('initial');
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresDocumentation, setRequiresDocumentation] = useState(false);
  const [userIncome, setUserIncome] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Initial bot message with slight delay for better UX
    const timer = setTimeout(() => {
      const initialMessage: Message = {
        id: '1',
        content: `Hello! Our records show that you currently owe $${currentDebt.toLocaleString()}. Are you able to resolve this debt today?`,
        sender: 'bot',
        timestamp: new Date()
      };
      setMessages([initialMessage]);
    }, 500);

    return () => clearTimeout(timer);
  }, [currentDebt]);

  const addMessage = (content: string, sender: 'bot' | 'user', isError = false) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      content,
      sender,
      timestamp: new Date(),
      isError
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const simulateTyping = async (response: string, isError = false) => {
    setIsTyping(true);
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
    setIsTyping(false);
    addMessage(response, 'bot', isError);
  };

  const generatePaymentOptions = (debtAmount: number, userInput: string) => {
    const lowerInput = userInput.toLowerCase();
    
    // Helper function for precise payment calculation with cents
    const calculatePaymentWithRemainder = (total: number, months: number) => {
      const basePayment = Math.floor((total / months) * 100) / 100;
      const totalBasePayments = basePayment * (months - 1);
      const finalPayment = Math.round((total - totalBasePayments) * 100) / 100;
      
      return {
        basePayment,
        finalPayment,
        months,
        isEvenSplit: Math.abs(basePayment - finalPayment) < 0.01
      };
    };
    
    // Check for income information
    const incomeMatch = userInput.match(/\$?(\d+(?:,\d{3})*)/);
    const income = incomeMatch ? parseInt(incomeMatch[1].replace(',', '')) : null;
    
         if (income && income > 500) {
       // Income-based negotiation strategy
       if (income >= 8000) {
         // HIGH INCOME: Start aggressive with 3 months
         const plan = calculatePaymentWithRemainder(debtAmount, 3);
         const paymentDescription = plan.isEvenSplit 
           ? `$${plan.basePayment.toFixed(2)} per month for 3 months`
           : `$${plan.basePayment.toFixed(2)} per month for 2 months, then $${plan.finalPayment.toFixed(2)} for the final payment`;
         
         return {
           monthlyAmount: plan.basePayment,
           termLength: 3,
           message: `Based on your income of $${income.toLocaleString()}/month, I can offer a quick resolution: ${paymentDescription}. This represents only ${Math.round((plan.basePayment / income) * 100)}% of your monthly income and gets this resolved fast. Does this work? (Total: $${debtAmount.toLocaleString()})`
         };
       } else if (income >= 3000) {
         // MEDIUM INCOME: Start with 6 months  
         const plan = calculatePaymentWithRemainder(debtAmount, 6);
         const paymentDescription = plan.isEvenSplit 
           ? `$${plan.basePayment.toFixed(2)} per month for 6 months`
           : `$${plan.basePayment.toFixed(2)} per month for 5 months, then $${plan.finalPayment.toFixed(2)} for the final payment`;
         
         return {
           monthlyAmount: plan.basePayment,
           termLength: 6,
           message: `Based on your income of $${income.toLocaleString()}/month, I can offer ${paymentDescription}. This represents about ${Math.round((plan.basePayment / income) * 100)}% of your monthly income, which is manageable. Does this work? (Total: $${debtAmount.toLocaleString()})`
         };
       } else {
         // LOW INCOME: Start conservative with 8-12 months
         const termLength = income < 1500 ? 12 : 8;
         const plan = calculatePaymentWithRemainder(debtAmount, termLength);
         const paymentDescription = plan.isEvenSplit 
           ? `$${plan.basePayment.toFixed(2)} per month for ${termLength} months`
           : `$${plan.basePayment.toFixed(2)} per month for ${termLength - 1} months, then $${plan.finalPayment.toFixed(2)} for the final payment`;
         
         return {
           monthlyAmount: plan.basePayment,
           termLength,
           message: `Based on your income of $${income.toLocaleString()}/month, I can offer ${paymentDescription}. This represents about ${Math.round((plan.basePayment / income) * 100)}% of your monthly income. ${termLength > 8 ? 'For this extended plan, we may need recent documentation to verify your financial situation.' : ''} Does this work? (Total: $${debtAmount.toLocaleString()})`
         };
       }
     }
    
    // Ask for income if not provided in various scenarios
    if (!lowerInput.includes('income') && !lowerInput.includes('make') && !lowerInput.includes('earn') && !lowerInput.includes('month')) {
      if (lowerInput.includes('laid off') || lowerInput.includes('lost job')) {
        return {
          monthlyAmount: 0,
          termLength: 0,
          message: `I understand you're dealing with job loss - that's really tough. To create the best payment plan for your situation, could you share if you have any current monthly income from unemployment benefits, savings, or other sources? Even a rough estimate helps me recommend something that won't add financial stress.`
        };
      } else if (lowerInput.includes('student') || lowerInput.includes('college')) {
        return {
          monthlyAmount: 0,
          termLength: 0,
          message: `I understand student finances can be tight. To suggest an appropriate payment plan, could you share your approximate monthly income from work, financial aid, or family support? This ensures any plan we create is realistic for your budget.`
        };
      }
      
      return {
        monthlyAmount: 0,
        termLength: 0,
        message: `I'd like to work with you on a plan that fits your financial situation. Could you share your approximate monthly income? This helps me recommend a payment plan that's typically 10-15% of your monthly income - an amount that won't strain your budget.`
      };
    }
    
    if (lowerInput.includes('laid off') || lowerInput.includes('lost job') || lowerInput.includes('unemployed')) {
      const plan = calculatePaymentWithRemainder(debtAmount, 8);
      const paymentDescription = plan.isEvenSplit 
        ? `${plan.basePayment.toFixed(2)} per month for 8 months`
        : `${plan.basePayment.toFixed(2)} per month for 7 months, then ${plan.finalPayment.toFixed(2)} for the final payment`;
        
      return {
        monthlyAmount: plan.basePayment,
        termLength: 8,
        message: `I understand you're going through a difficult time with job loss. We want to help. How about ${paymentDescription}? If this is still challenging, please share your current monthly income and we can adjust accordingly. (Total: ${debtAmount.toLocaleString()})`
      };
    } else if (lowerInput.includes('too high') || lowerInput.includes('can\'t afford') || lowerInput.includes('too much')) {
      const plan = calculatePaymentWithRemainder(debtAmount, 10);
      const paymentDescription = plan.isEvenSplit 
        ? `${plan.basePayment.toFixed(2)} per month for 10 months`
        : `${plan.basePayment.toFixed(2)} per month for 9 months, then ${plan.finalPayment.toFixed(2)} for the final payment`;
        
      return {
        monthlyAmount: plan.basePayment,
        termLength: 10,
        message: `I completely understand. Let's make this more manageable. How about ${paymentDescription}? If you could share your monthly income, I can suggest an amount that's typically 10-15% of your budget. (Total: ${debtAmount.toLocaleString()})`
      };
    } else if (lowerInput.includes('student') || lowerInput.includes('college')) {
      const plan = calculatePaymentWithRemainder(debtAmount, 12);
      const paymentDescription = plan.isEvenSplit 
        ? `${plan.basePayment.toFixed(2)} per month for 12 months`
        : `${plan.basePayment.toFixed(2)} per month for 11 months, then ${plan.finalPayment.toFixed(2)} for the final payment`;
        
      return {
        monthlyAmount: plan.basePayment,
        termLength: 12,
        message: `I understand student finances are challenging. What about ${paymentDescription}? If you could share your monthly income from work or support, I can recommend an amount that fits your student budget better. (Total: ${debtAmount.toLocaleString()})`
      };
    } else if (lowerInput.includes('yes') || lowerInput.includes('works') || lowerInput.includes('good') || lowerInput.includes('okay') || lowerInput.includes('fine')) {
      return null;
    } else {
      const plan = calculatePaymentWithRemainder(debtAmount, 6);
      const paymentDescription = plan.isEvenSplit 
        ? `${plan.basePayment.toFixed(2)} per month for 6 months`
        : `${plan.basePayment.toFixed(2)} per month for 5 months, then ${plan.finalPayment.toFixed(2)} for the final payment`;
        
      return {
        monthlyAmount: plan.basePayment,
        termLength: 6,
        message: `I'd like to work with you on this. How does ${paymentDescription} sound? To ensure this is comfortable for your budget, could you share your approximate monthly income? I typically recommend debt payments be around 10-15% of monthly income. (Total: ${debtAmount.toLocaleString()})`
      };
    }
  };

  const handlePaymentAgreement = (monthlyAmount: number, termLength: number) => {
    // Convert to cents to avoid decimal issues in URL
    const totalDebtCents = Math.round(currentDebt * 100);
    const monthlyAmountCents = Math.round(monthlyAmount * 100);
    
    const paymentUrl = `collectwise.com/payments?termLength=${termLength}&totalDebtAmountCents=${totalDebtCents}&termPaymentAmountCents=${monthlyAmountCents}`;
    setPaymentPlan({
      totalDebt: currentDebt,
      termLength,
      monthlyPayment: monthlyAmount,
      frequency: 'monthly'
    });
    setNegotiationState('completed');
    
    const successMessage = `Perfect! I've set up your payment plan. Here's your secure payment link to get started: ${paymentUrl}`;
    simulateTyping(successMessage);
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault();
    if (!inputValue.trim()) return;

    setError(null);
    addMessage(inputValue, 'user');
    const userInput = inputValue;
    setInputValue('');

    if (negotiationState === 'completed') {
      simulateTyping("You're very welcome! Feel free to reach out if you need any adjustments to your payment plan. Have a wonderful day!");
      return;
    }

    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userInput,
          conversationHistory: messages,
          totalDebt: currentDebt,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      setIsTyping(false);
      addMessage(data.response, 'bot');

             // Check for income information in user input
       const incomeMatch = userInput.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)[kK]?/);
       if (incomeMatch && (userInput.toLowerCase().includes('income') || userInput.toLowerCase().includes('make') || userInput.toLowerCase().includes('earn') || userInput.toLowerCase().includes('salary'))) {
         let income = parseInt(incomeMatch[1].replace(/,/g, ''));
         
         // Handle clear annual indicators
         const isAnnual = userInput.toLowerCase().includes('year') || 
                          userInput.toLowerCase().includes('annual') || 
                          userInput.toLowerCase().includes('salary') ||
                          userInput.toLowerCase().includes('pretax') ||
                          userInput.match(/\d+[kK]/); // 150K format
         
         // Handle clear monthly indicators
         const isMonthly = userInput.toLowerCase().includes('month') || 
                           userInput.toLowerCase().includes('per month') ||
                           userInput.toLowerCase().includes('monthly');
         
         if (isAnnual) {
           // Handle K suffix (150K = 150,000)
           if (userInput.match(/\d+[kK]/)) {
             income = income * 1000;
           }
           income = Math.round(income / 12); // Convert annual to monthly
           setUserIncome(income);
         } else if (isMonthly) {
           // Already monthly, use as-is
           setUserIncome(income);
         } else if (income > 8000) {
           // Ask for clarification on ambiguous high amounts
           addMessage(`Just to clarify - when you mentioned $${income.toLocaleString()}, did you mean monthly or annual income? This helps me calculate the right payment plan for your budget.`, 'bot');
           return;
         } else {
           // Assume monthly for reasonable amounts
           setUserIncome(income);
         }
       }
       
       // Handle clarification responses (monthly vs annual)
       if (userInput.toLowerCase().includes('monthly') || userInput.toLowerCase().includes('annual') || userInput.toLowerCase().includes('yearly')) {
         const previousMessage = messages[messages.length - 1];
         if (previousMessage && previousMessage.content.includes('monthly or annual income')) {
           // Extract the income amount from the previous bot message
           const amountMatch = previousMessage.content.match(/\$(\d+(?:,\d{3})*)/);
           if (amountMatch) {
             let income = parseInt(amountMatch[1].replace(/,/g, ''));
             
             if (userInput.toLowerCase().includes('annual') || userInput.toLowerCase().includes('yearly')) {
               income = Math.round(income / 12); // Convert annual to monthly
             }
             // For monthly, use as-is
             
             setUserIncome(income);
           }
         }
       }

      // Check for documentation requirements
      if (data.response.toLowerCase().includes('documentation') || data.response.toLowerCase().includes('pay stubs') || data.response.toLowerCase().includes('bank statements')) {
        setRequiresDocumentation(true);
      }

      if (data.agreementReached) {
        // Handle both old and new URL formats
        const urlMatchCents = data.response.match(/termLength=(\d+)&totalDebtAmountCents=(\d+)&termPaymentAmountCents=(\d+)/);
        const urlMatchDollars = data.response.match(/termLength=(\d+)&totalDebtAmount=(\d+)&termPaymentAmount=(\d+)/);
        
        if (urlMatchCents) {
          const [, termLength, totalAmountCents, paymentAmountCents] = urlMatchCents;
          setPaymentPlan({
            totalDebt: parseInt(totalAmountCents) / 100, // Convert cents back to dollars
            termLength: parseInt(termLength),
            monthlyPayment: parseInt(paymentAmountCents) / 100, // Convert cents back to dollars
            frequency: 'monthly'
          });
          setNegotiationState('completed');
        } else if (urlMatchDollars) {
          const [, termLength, totalAmount, paymentAmount] = urlMatchDollars;
          setPaymentPlan({
            totalDebt: parseInt(totalAmount),
            termLength: parseInt(termLength),
            monthlyPayment: parseInt(paymentAmount),
            frequency: 'monthly'
          });
          setNegotiationState('completed');
        }
      } else {
        setNegotiationState('negotiating');
      }

    } catch (error) {
      console.error('Chat API Error:', error);
      setIsTyping(false);
      
      // Show error state but continue with fallback
      setError('Connection issue - using offline mode');
      
      // Fallback to local logic
      setNegotiationState('negotiating');
      const paymentOption = generatePaymentOptions(currentDebt, userInput);
      if (paymentOption && paymentOption.monthlyAmount > 0) {
        simulateTyping(paymentOption.message);
      } else {
        simulateTyping("I want to make sure we find a plan that works for your budget. What monthly payment amount would be comfortable for you?");
      }
    }
  };

  const clearError = () => setError(null);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-full">
            <DollarSign className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">CollectWise Payment Assistant</h1>
            <p className="text-sm text-gray-500">Let's work together to find a payment solution that works for you</p>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex items-center justify-between">
            <div className="flex">
              <AlertCircle className="w-5 h-5 text-yellow-400 mr-2" />
              <p className="text-sm text-yellow-800">{error}</p>
            </div>
            <button
              onClick={clearError}
              className="text-yellow-600 hover:text-yellow-800 text-sm underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Documentation Requirements Banner */}
      {requiresDocumentation && (
        <div className="mx-4 mb-4">
          <div className="max-w-4xl mx-auto bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-blue-800">Documentation Required</h3>
            </div>
            <p className="text-sm text-blue-700">
              For extended payment plans or reduced payments, we need to verify your financial situation with recent documentation such as pay stubs, unemployment benefits statements, or bank statements.
            </p>
          </div>
        </div>
      )}

      {/* Income Assessment Display */}
      {userIncome && !paymentPlan && (
        <div className="mx-4 mb-4">
          <div className="max-w-4xl mx-auto bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-indigo-600" />
              <h3 className="font-semibold text-indigo-800">Financial Assessment</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div className="text-indigo-700">
                <p className="font-medium">Monthly Income</p>
                <p className="text-lg font-semibold">${userIncome.toLocaleString()}</p>
              </div>
                             <div className="text-indigo-700">
                 <p className="font-medium">Recommended Payment Range</p>
                 <p className="text-lg font-semibold">${(userIncome * 0.10).toFixed(2)} - ${(userIncome * 0.20).toFixed(2)}</p>
               </div>
               <div className="text-indigo-700">
                 <p className="font-medium">Debt-to-Income Impact</p>
                 <p className="text-lg font-semibold">{((userIncome * 0.15) / userIncome * 100).toFixed(1)}% of income</p>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'} message-enter`}
            >
              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                message.sender === 'bot' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-600 text-white'
              }`}>
                {message.sender === 'bot' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
              </div>
              <div className={`flex flex-col max-w-xs sm:max-w-md lg:max-w-lg ${
                message.sender === 'user' ? 'items-end' : 'items-start'
              }`}>
                <div className={`rounded-2xl px-4 py-3 ${
                  message.sender === 'bot'
                    ? message.isError 
                      ? 'bg-red-100 text-red-800 border border-red-200'
                      : 'bg-white text-gray-800 shadow-sm border border-gray-100'
                    : 'bg-blue-600 text-white shadow-sm'
                }`}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                </div>
                <span className="text-xs text-gray-500 mt-1">
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex gap-3 message-enter">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Payment Plan Summary */}
      {paymentPlan && (
        <div className="mx-4 mb-4">
          <div className="max-w-4xl mx-auto bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-green-800">Payment Plan Confirmed</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div className="text-green-700">
                <p className="font-medium">Total Debt</p>
                <p className="text-lg font-semibold">${paymentPlan.totalDebt.toLocaleString()}</p>
              </div>
              <div className="text-green-700">
                <p className="font-medium">Monthly Payment</p>
                <p className="text-lg font-semibold">${paymentPlan.monthlyPayment.toFixed(2)}</p>
              </div>
              <div className="text-green-700">
                <p className="font-medium">Payment Term</p>
                <p className="text-lg font-semibold">{paymentPlan.termLength} months</p>
              </div>
            </div>
                         {userIncome && (
               <div className="mt-3 pt-3 border-t border-green-200">
                 <p className="text-xs text-green-600">
                   This represents {((paymentPlan.monthlyPayment / userIncome) * 100).toFixed(1)}% of your monthly income
                 </p>
               </div>
             )}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="bg-white border-t px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSubmit(e)}
              placeholder="Type your message..."
              disabled={isTyping}
              className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed transition-all"
            />
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isTyping}
              className="bg-blue-600 text-white rounded-xl px-6 py-3 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Press Enter to send • Your information is secure and confidential
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;