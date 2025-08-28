import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, DollarSign, CheckCircle, AlertCircle, FileText, ExternalLink, Check, Upload, X, RefreshCw, Paperclip, ChevronDown, ChevronUp } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  sender: 'bot' | 'user';
  timestamp: Date;
  isError?: boolean;
}

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: Date;
  url?: string;
  base64?: string;
}

interface PaymentPlan {
  totalDebt: number;
  termLength: number;
  monthlyPayment: number;
  frequency: 'monthly' | 'biweekly' | 'weekly';
}

const ChatInterface = () => {
  const [currentDebt] = useState(2400);
  const [messages, setMessages] = useState<Message[]>([{
    id: '1',
    content: `Hello! Our records show that you currently owe $${currentDebt.toLocaleString()}. Are you able to resolve this debt today?`,
    sender: 'bot',
    timestamp: new Date()
  }]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [negotiationState, setNegotiationState] = useState<'initial' | 'negotiating' | 'completed'>('initial');
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresDocumentation, setRequiresDocumentation] = useState(false);
  const [userIncome, setUserIncome] = useState<number | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadExpanded, setIsUploadExpanded] = useState(false);
  const [canUploadMore, setCanUploadMore] = useState(false);
  const [isProcessingDocs, setIsProcessingDocs] = useState(false);
  const [documentMessages, setDocumentMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Cleanup file URLs on unmount
  useEffect(() => {
    return () => {
      uploadedFiles.forEach(file => {
        if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      });
    };
  }, [uploadedFiles]);

  const addMessage = (content: string, sender: 'bot' | 'user', isError = false) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      content,
      sender,
      timestamp: new Date(),
      isError
    };
    setMessages(prev => {
      // Prevent duplicate bot messages about documents
      if (sender === 'bot' && content.toLowerCase().includes('documents did not demonstrate')) {
        const hasSimilar = prev.some(msg => 
          msg.sender === 'bot' && 
          msg.content.toLowerCase().includes('documents did not demonstrate') &&
          Date.now() - msg.timestamp.getTime() < 5000 // Within 5 seconds
        );
        if (hasSimilar) return prev;
      }
      return [...prev, newMessage];
    });
  };

  const simulateTyping = async (response: string, isError = false) => {
    setIsTyping(true);
    // Reduced from 1-2 seconds to 0.3-0.8 seconds for faster responses
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
    setIsTyping(false);
    addMessage(response, 'bot', isError);
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault();
    if (!inputValue.trim()) return;

    setError(null);
    addMessage(inputValue, 'user');
    const userInput = inputValue;
    setInputValue('');

    if (negotiationState === 'completed') {
      simulateTyping("Thank you! If you need any assistance with your payment plan, please don't hesitate to reach out.");
      return;
    }

    setIsTyping(true);

    try {
      // Convert uploaded files to include base64 data
      const filesWithData = await Promise.all(
        uploadedFiles.map(async (file) => {
          if (file.url && !file.base64) {
            // Convert blob URL to base64
            const response = await fetch(file.url);
            const blob = await response.blob();
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => {
                const base64 = reader.result as string;
                resolve(base64);
              };
            });
            reader.readAsDataURL(blob);
            const base64 = await base64Promise;
            
            return {
              name: file.name,
              size: file.size,
              type: file.type,
              uploadedAt: file.uploadedAt,
              dataUrl: base64
            };
          }
          return {
            name: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: file.uploadedAt,
            dataUrl: file.base64 || file.url
          };
        })
      );

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userInput,
          conversationHistory: messages,
          totalDebt: currentDebt,
          uploadedFiles: [], // Don't send files on regular messages
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      setIsTyping(false);
      addMessage(data.response, 'bot');

      // Process income information from user input
      const incomeMatch = userInput.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)[kK]?/);
      if (incomeMatch && (userInput.toLowerCase().includes('income') || userInput.toLowerCase().includes('make') || userInput.toLowerCase().includes('earn') || userInput.toLowerCase().includes('salary'))) {
         let income = parseInt(incomeMatch[1].replace(/,/g, ''));
         
         const isAnnual = userInput.toLowerCase().includes('year') || 
                          userInput.toLowerCase().includes('annual') || 
                          userInput.toLowerCase().includes('salary') ||
                          userInput.toLowerCase().includes('pretax');
         
         const isMonthly = userInput.toLowerCase().includes('month') || 
                           userInput.toLowerCase().includes('per month') ||
                           userInput.toLowerCase().includes('monthly');
         
         if (isAnnual) {
           if (userInput.match(/\d+[kK]/)) {
             income = income * 1000;
           }
           income = Math.round(income / 12);
           setUserIncome(income);
         } else if (isMonthly) {
           setUserIncome(income);
         } else {
           if (userInput.match(/\d+[kK]/) || income >= 2500) {
             const displayAmount = userInput.match(/\d+[kK]/) ? `${income}K` : `$${income.toLocaleString()}`;
             addMessage(`Just to clarify - when you mentioned ${displayAmount}, did you mean monthly or annual income?\n\nThis helps me calculate the right payment plan for your budget.`, 'bot');
             return;
           } else {
             setUserIncome(income);
           }
         }
      }
       
      // Handle clarification (monthly vs annual)
       if (userInput.toLowerCase().includes('monthly') || userInput.toLowerCase().includes('annual') || userInput.toLowerCase().includes('yearly')) {
         const previousMessage = messages[messages.length - 1];
         if (previousMessage && previousMessage.content.includes('monthly or annual income')) {
           const amountMatch = previousMessage.content.match(/\$(\d+(?:,\d{3})*)/);
           if (amountMatch) {
             let income = parseInt(amountMatch[1].replace(/,/g, ''));
             
             if (userInput.toLowerCase().includes('annual') || userInput.toLowerCase().includes('yearly')) {
               income = Math.round(income / 12);
             }
             
             setUserIncome(income);
           }
         }
       }

      // Check for documentation requirements
      if (data.response.toLowerCase().includes('documentation') || 
          data.response.toLowerCase().includes('pay stubs') || 
          data.response.toLowerCase().includes('bank statements') || 
          data.response.toLowerCase().includes('verify') || 
          data.response.toLowerCase().includes('proof') ||
          data.response.toLowerCase().includes('unemployment benefits') ||
          data.response.toLowerCase().includes('job search records')) {
        setRequiresDocumentation(true);
        setIsUploadExpanded(true);
        setCanUploadMore(true);
      }

      // Check if response contains payment URL (agreement reached)
      const urlMatch = data.response.match(/collectwise\.com\/payments\?termLength=(\d+)&totalDebtAmount=(\d+(?:\.\d{2})?)&termPaymentAmount=(\d+(?:\.\d{2})?)/);
      
      if (urlMatch || data.agreementReached) {
        if (urlMatch) {
          const [, termLength, totalAmount, paymentAmount] = urlMatch;
          const parsedPaymentAmount = parseFloat(paymentAmount);
          
          // Calculate payment amount if it's NaN
          const actualPaymentAmount = isNaN(parsedPaymentAmount) 
            ? Math.round((currentDebt / parseInt(termLength)) * 100) / 100 
            : parsedPaymentAmount;
          
          setPaymentPlan({
            totalDebt: parseFloat(totalAmount),
            termLength: parseInt(termLength),
            monthlyPayment: actualPaymentAmount,
            frequency: 'monthly'
          });
        } else if (data.agreementReached) {
          // Extract terms from response text if URL match failed
          const termMatch = data.response.match(/(\d+)\s*months?/i);
          const paymentMatch = data.response.match(/\$(\d+(?:\.\d{2})?)\s*(?:per|\/)\s*month/i);
          
          if (termMatch) {
            const termLength = parseInt(termMatch[1]);
            const monthlyPayment = paymentMatch 
              ? parseFloat(paymentMatch[1]) 
              : Math.round((currentDebt / termLength) * 100) / 100;
            
            setPaymentPlan({
              totalDebt: currentDebt,
              termLength: termLength,
              monthlyPayment: monthlyPayment,
              frequency: 'monthly'
            });
          }
        }
        setNegotiationState('completed');
      } else {
        setNegotiationState('negotiating');
      }

    } catch (error) {
      console.error('Chat API Error:', error);
      setIsTyping(false);
      setError('Connection issue - using offline mode');
      setNegotiationState('negotiating');
      
      // Fallback logic for when API is unavailable
      simulateTyping("I want to make sure we find a plan that works for your budget. What monthly payment amount would be comfortable for you?");
    }
  };

  const clearError = () => setError(null);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const extractUrlFromMessage = (message: string): string | null => {
    const urlMatch = message.match(/collectwise\.com\/payments\?[^\s]+/);
    return urlMatch ? urlMatch[0] : null;
  };

  const refreshChat = () => {
    setMessages([]);
    setInputValue('');
    setIsTyping(false);
    setNegotiationState('initial');
    setPaymentPlan(null);
    setError(null);
    setRequiresDocumentation(false);
    setUserIncome(null);
    setCopiedUrl(null);
    setUploadedFiles([]);
    setIsDragging(false);
    setIsUploading(false);
    setIsUploadExpanded(false);
    setCanUploadMore(false);
    setIsProcessingDocs(false);
    
    // Restart with initial message
    setTimeout(() => {
      const initialMessage: Message = {
        id: '1',
        content: `Hello! Our records show that you currently owe $${currentDebt.toLocaleString()}. Are you able to resolve this debt today?`,
        sender: 'bot',
        timestamp: new Date()
      };
      setMessages([initialMessage]);
    }, 500);
  };

  const handleFileUpload = async (files: FileList) => {
    const validFiles = Array.from(files).filter(file => {
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      const maxSize = 10 * 1024 * 1024; // 10MB
      return validTypes.includes(file.type) && file.size <= maxSize;
    });

    if (validFiles.length === 0) {
      setError('Please upload valid files (PDF, JPG, PNG, DOC, DOCX, TXT) under 10MB');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const newFiles: UploadedFile[] = await Promise.all(
        validFiles.map(async (file) => {
          // Convert to base64 for image files
          let base64Data: string | undefined;
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => {
                resolve(reader.result as string);
              };
            });
            reader.readAsDataURL(file);
            base64Data = await base64Promise;
          }

          return {
            id: Date.now().toString() + Math.random(),
            name: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: new Date(),
            url: URL.createObjectURL(file),
            base64: base64Data
          };
        })
      );

      setUploadedFiles(prev => {
        const updatedFiles = [...prev, ...newFiles];
        
        // Disable further uploads and trigger analysis
        setCanUploadMore(false);
        // Auto-collapse upload area after successful upload
        setIsUploadExpanded(false);
        setTimeout(() => {
          handleDocumentAnalysis(updatedFiles);
        }, 500);
        
        return updatedFiles;
      });
      
    } catch (error) {
      console.error('File upload error:', error);
      setError('Failed to upload files. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDocumentAnalysis = async (files: UploadedFile[]) => {
    if (isProcessingDocs) return; // Prevent duplicate processing
    
    // Additional guard - check if we already processed these files
    const fileIds = files.map(f => f.id).sort().join(',');
    if (documentMessages.has(fileIds)) return;
    
    setIsProcessingDocs(true);
    setIsTyping(true);
    setDocumentMessages(prev => new Set([...prev, fileIds]));
    
    try {
      // Convert files to proper format for API
      const filesWithData = await Promise.all(
        files.map(async (file) => {
          if (file.base64) {
            return {
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl: file.base64
            };
          } else if (file.url) {
            const response = await fetch(file.url);
            const blob = await response.blob();
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => {
                resolve(reader.result as string);
              };
            });
            reader.readAsDataURL(blob);
            const base64 = await base64Promise;
            
            return {
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl: base64
            };
          }
          return {
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: ''
          };
        })
      );

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: "I've uploaded my documentation. Can you review it and let me know what payment options are available?",
          conversationHistory: messages,
          totalDebt: currentDebt,
          uploadedFiles: filesWithData
        })
      });

      const data = await response.json();
      
      setIsTyping(false);
      
      // Simply add the API response
      addMessage(data.response, 'bot');
      
      // Update documentation status based on approval
      if (data.documentApproved) {
        setRequiresDocumentation(false);
        setCanUploadMore(false);
      } else {
        // If documents were rejected, allow another upload attempt
        setCanUploadMore(true);
      }
      
    } catch (error) {
      console.error('Error analyzing documents:', error);
      setIsTyping(false);
      
      const fallbackMessage = `I've received your ${files.length} document${files.length > 1 ? 's' : ''}. Based on this information, let me suggest some payment options for your debt of $${currentDebt.toLocaleString()}.`;
      addMessage(fallbackMessage, 'bot');
    } finally {
      setIsProcessingDocs(false);
    }
  };

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => {
      const fileToRemove = prev.find(f => f.id === fileId);
      if (fileToRemove?.url) {
        URL.revokeObjectURL(fileToRemove.url);
      }
      return prev.filter(f => f.id !== fileId);
    });
    
    // Re-enable upload if all files are removed
    if (uploadedFiles.length === 1) { // Will be 0 after filter
      setCanUploadMore(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && canUploadMore) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md shadow-lg border-b border-white/20 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-3 rounded-2xl shadow-lg">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold bg-gradient-to-r from-gray-900 to-blue-900 bg-clip-text text-transparent">CollectWise Payment Assistant</h1>
              <p className="text-sm text-gray-600">Let's work together to find a payment solution that works for you</p>
            </div>
          </div>
          <button
            onClick={refreshChat}
            className="bg-white/50 hover:bg-white/80 border border-gray-200/50 rounded-xl px-4 py-2 flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md"
            title="Start new conversation"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-sm font-medium">New Chat</span>
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-4 mt-4">
          <div className="max-w-4xl mx-auto bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200/50 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex">
                <AlertCircle className="w-5 h-5 text-yellow-500 mr-2" />
                <p className="text-sm text-yellow-800">{error}</p>
              </div>
              <button
                onClick={clearError}
                className="text-yellow-600 hover:text-yellow-800 text-sm underline transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documentation Requirements Banner */}
      {requiresDocumentation && (
        <div className="mx-4 mb-2">
          <div className="max-w-4xl mx-auto bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl shadow-sm backdrop-blur-sm">
            {/* Collapsible Header */}
            <div 
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-blue-100/30 transition-colors"
              onClick={() => setIsUploadExpanded(!isUploadExpanded)}
            >
              <div className="flex items-center gap-2">
                <div className="bg-blue-100 p-1.5 rounded-lg">
                  <FileText className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-blue-900">Documentation Required</h3>
                  <p className="text-blue-700 text-xs">
                    {uploadedFiles.length > 0 
                      ? `${uploadedFiles.length} document(s) uploaded` 
                      : 'Upload for extended payment terms'
                    }
                  </p>
                </div>
              </div>
              {isUploadExpanded ? (
                <ChevronUp className="w-4 h-4 text-blue-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-blue-600" />
              )}
            </div>

            {/* Expandable Upload Description - More compact */}
            {isUploadExpanded && (
              <div className="px-3 pb-3 border-t border-blue-200">
                <p className="text-xs text-blue-700 leading-relaxed mt-2">
                  Valid documents: unemployment benefits • termination letters • medical bills ($500+) • reduced income statements
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File Upload Section - More compact */}
      {((requiresDocumentation && isUploadExpanded && canUploadMore) || (uploadedFiles.length > 0 && isUploadExpanded)) && (
        <div className="mx-4 mb-2">
          <div className="max-w-4xl mx-auto">
            {/* File Upload Area - Compact design */}
            {canUploadMore && (
              <div 
                className={`border-2 border-dashed rounded-xl p-4 transition-all duration-200 ${
                  isDragging 
                    ? 'border-blue-400 bg-blue-50/50' 
                    : 'border-gray-300/50 bg-white/30'
                } backdrop-blur-sm hover:border-blue-400/50 hover:bg-blue-50/30`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">Upload Documentation</h3>
                    <p className="text-xs text-gray-600 mt-1">
                      Drag and drop or click to browse • PDF, JPG, PNG (Max 10MB)
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
                    onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 font-medium text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUploading ? (
                      <span className="flex items-center gap-2">
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Uploading...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Paperclip className="w-3 h-3" />
                        Choose Files
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Uploaded Files List - Compact */}
            {uploadedFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                <h4 className="text-xs font-medium text-gray-700">Uploaded Documents</h4>
                {uploadedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between bg-white/60 backdrop-blur-sm border border-gray-200/50 rounded-lg p-2 shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <div className="bg-green-100 p-1 rounded">
                        <FileText className="w-3 h-3 text-green-600" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-900">{file.name}</p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(file.size)} • {file.uploadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(file.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                      title="Remove file"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.map((message) => {
            const paymentUrl = extractUrlFromMessage(message.content);
            // Fix payment URL if it contains NaN
            const fixedUrl = paymentUrl && paymentUrl.includes('NaN') 
              ? paymentUrl.replace(/termPaymentAmount=NaN/, `termPaymentAmount=${paymentPlan ? paymentPlan.monthlyPayment : Math.round((currentDebt / 12) * 100) / 100}`)
              : paymentUrl;
            
            return (
              <div
                key={message.id}
                className={`flex gap-3 ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'} message-enter`}
              >
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-md ${
                  message.sender === 'bot' 
                    ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white' 
                    : 'bg-gradient-to-br from-gray-600 to-gray-700 text-white'
                }`}>
                  {message.sender === 'bot' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
                </div>
                <div className={`flex ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-2 max-w-xs sm:max-w-md lg:max-w-lg`}>
                  <div className={`flex flex-col ${
                    message.sender === 'user' ? 'items-end' : 'items-start'
                  }`}>
                    <div className={`rounded-2xl px-4 py-3 shadow-lg backdrop-blur-sm relative ${
                      message.sender === 'bot'
                        ? message.isError 
                          ? 'bg-gradient-to-r from-red-50 to-red-100 text-red-800 border border-red-200/50'
                          : 'bg-white/90 text-gray-800 border border-gray-200/50'
                        : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white'
                    }`}>
                      <p 
                        className="text-sm leading-relaxed whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{
                          __html: message.content
                            .replace(/\[?(collectwise\.com\/payments\?[^\s\]]+)\]?/g, '<strong style="background: linear-gradient(to right, #3b82f6, #1d4ed8); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; font-weight: 600;">$1</strong>')
                            .replace(/(\$[\d,]+(?:\.\d{2})?)/g, '<strong>$1</strong>')
                            .replace(/(Perfect!|Great!|Excellent!)/g, '<strong>$1</strong>')
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 mt-1">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {fixedUrl && message.sender === 'bot' && (
                    <button
                      onClick={() => window.open(`https://${fixedUrl}`, '_blank', 'noopener,noreferrer')}
                      className="flex-shrink-0 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200 group self-center"
                      title="Open payment link"
                    >
                      <ExternalLink className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          
          {isTyping && (
            <div className="flex gap-3 message-enter">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 text-white flex items-center justify-center shadow-md">
                <Bot className="w-5 h-5" />
              </div>
              <div className="bg-white/90 rounded-2xl px-4 py-3 shadow-lg border border-gray-200/50 backdrop-blur-sm">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
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
          <div className="max-w-4xl mx-auto bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/50 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-green-100 p-2 rounded-xl">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <h3 className="font-semibold text-green-900">Payment Plan Confirmed</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
              <div className="text-green-700 bg-white/50 rounded-xl p-4">
                <p className="font-medium text-green-600">Total Debt</p>
                <p className="text-xl font-semibold text-green-900">${paymentPlan.totalDebt.toLocaleString()}</p>
              </div>
              <div className="text-green-700 bg-white/50 rounded-xl p-4">
                <p className="font-medium text-green-600">Monthly Payment</p>
                <p className="text-xl font-semibold text-green-900">
                  ${isNaN(paymentPlan.monthlyPayment) 
                    ? (paymentPlan.totalDebt / paymentPlan.termLength).toFixed(2) 
                    : paymentPlan.monthlyPayment.toFixed(2)}
                </p>
              </div>
              <div className="text-green-700 bg-white/50 rounded-xl p-4">
                <p className="font-medium text-green-600">Payment Term</p>
                <p className="text-xl font-semibold text-green-900">{paymentPlan.termLength} months</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="bg-white/80 backdrop-blur-md border-t border-white/20 px-4 py-4 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-3">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !isTyping && !isProcessingDocs && handleSubmit(e)}
              placeholder="Type your message..."
              className="flex-1 border border-gray-300/50 rounded-2xl px-6 py-4 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-200 bg-white/90 backdrop-blur-sm shadow-sm"
            />
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isTyping || isProcessingDocs}
              className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl px-6 py-4 hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-105"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-3 text-center">
            Press Enter to send • Your information is secure and confidential
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;