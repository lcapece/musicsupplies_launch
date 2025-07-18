import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EmailRequest {
  to: string;
  subject: string;
  text: string;
  html?: string;
  testMode?: boolean;
  diagnostics?: boolean;
  testCredentials?: boolean;
  healthCheck?: boolean;
}

interface DiagnosticInfo {
  timestamp: string;
  requestId: string;
  environment: {
    hasApiKey: boolean;
    hasSendingKey: boolean;
    hasDomain: boolean;
    domain: string;
  };
  mailgunTest?: {
    status: number;
    response: any;
    error?: string;
  };
  processInfo: {
    denoVersion: string;
    hostname: string;
  };
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function logWithContext(level: 'INFO' | 'WARN' | 'ERROR', message: string, context: any = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...context
  };
  console.log(`[${level}] ${timestamp} - ${message}`, context);
  return logEntry;
}

serve(async (req) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestBody: EmailRequest = await req.json()
    const { 
      to, 
      subject, 
      text, 
      html, 
      testMode = false, 
      diagnostics = false,
      testCredentials = false,
      healthCheck = false 
    } = requestBody;

    logWithContext('INFO', 'Email function invoked', {
      requestId,
      testMode,
      diagnostics,
      testCredentials,
      healthCheck,
      hasTo: !!to,
      hasSubject: !!subject,
      hasText: !!text,
      hasHtml: !!html
    });

    // Get environment variables
    const MAILGUN_API_KEY = Deno.env.get('MAILGUN_API_KEY')
    const MAILGUN_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') || 'mg.musicsupplies.com'
    const MAILGUN_SENDING_KEY = Deno.env.get('MAILGUN_SENDING_KEY')

    const environmentInfo = {
      hasApiKey: !!MAILGUN_API_KEY,
      hasSendingKey: !!MAILGUN_SENDING_KEY,
      hasDomain: !!MAILGUN_DOMAIN,
      domain: MAILGUN_DOMAIN
    };

    // Handle health check request
    if (healthCheck) {
      logWithContext('INFO', 'Health check requested', { requestId });
      
      const vaultStatus = environmentInfo.hasApiKey && environmentInfo.hasSendingKey ? 'configured' : 'missing';
      
      return new Response(
        JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          requestId,
          vaultStatus,
          environment: environmentInfo,
          processInfo: {
            denoVersion: Deno.version.deno,
            hostname: 'edge-function'
          }
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Handle credential test request
    if (testCredentials) {
      logWithContext('INFO', 'Credential test requested', { requestId });
      
      // Check if credentials exist
      if (!MAILGUN_API_KEY || !MAILGUN_SENDING_KEY) {
        logWithContext('WARN', 'Missing Mailgun credentials for test', {
          requestId,
          hasApiKey: !!MAILGUN_API_KEY,
          hasSendingKey: !!MAILGUN_SENDING_KEY,
          hasDomain: !!MAILGUN_DOMAIN
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Mailgun credentials not configured in Supabase Edge Vault',
            environment: environmentInfo,
            suggestions: [
              'Go to Supabase Dashboard → Edge Functions → Settings',
              'Add MAILGUN_API_KEY with your Mailgun private API key',
              'Add MAILGUN_SENDING_KEY with your Mailgun sending key',
              'Ensure MAILGUN_DOMAIN is set to mg.musicsupplies.com',
              'Deploy the Edge Function after adding credentials'
            ],
            troubleshooting: {
              step1: 'Verify credentials are saved in Supabase Edge Vault',
              step2: 'Ensure Edge Function is deployed after adding credentials',
              step3: 'Check Mailgun dashboard for correct API keys'
            }
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      // Log credential check attempt
      logWithContext('INFO', 'Testing Mailgun API connectivity', {
        requestId,
        domain: MAILGUN_DOMAIN,
        apiKeyLength: MAILGUN_API_KEY.length,
        sendingKeyLength: MAILGUN_SENDING_KEY.length
      });

      // Test Mailgun domain verification endpoint
      try {
        const testUrl = `https://api.mailgun.net/v3/domains/${MAILGUN_DOMAIN}`;
        
        logWithContext('INFO', 'Making request to Mailgun API', {
          requestId,
          url: testUrl,
          method: 'GET'
        });

        const testResponse = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
            'User-Agent': 'MusicSupplies-EdgeFunction/1.0'
          },
        });

        let testResult: any = {};
        let responseText = '';
        
        try {
          responseText = await testResponse.text();
          if (responseText) {
            testResult = JSON.parse(responseText);
          }
        } catch (parseError) {
          logWithContext('WARN', 'Could not parse Mailgun response as JSON', {
            requestId,
            responseText: responseText.substring(0, 500)
          });
          testResult = { rawResponse: responseText };
        }
        
        logWithContext('INFO', 'Mailgun API response received', {
          requestId,
          status: testResponse.status,
          statusText: testResponse.statusText,
          ok: testResponse.ok,
          responseLength: responseText.length
        });

        // Determine success based on status
        const isSuccess = testResponse.ok && testResponse.status === 200;
        let message = '';
        let errorDetails: any = null;

        if (isSuccess) {
          const domainState = testResult?.domain?.state || 'unknown';
          message = `Credentials valid! Domain state: ${domainState}`;
          
          if (domainState !== 'active') {
            message += ` (Note: Domain should be "active" for full functionality)`;
          }
        } else {
          // Analyze specific error types
          if (testResponse.status === 401) {
            message = 'Authentication failed - Invalid API key';
            errorDetails = {
              issue: 'Invalid or expired API key',
              solutions: [
                'Verify MAILGUN_API_KEY in Supabase Edge Vault',
                'Generate new API key in Mailgun dashboard if needed',
                'Ensure API key has domain access permissions'
              ]
            };
          } else if (testResponse.status === 404) {
            message = 'Domain not found in Mailgun account';
            errorDetails = {
              issue: 'Domain mg.musicsupplies.com not found',
              solutions: [
                'Add domain mg.musicsupplies.com to your Mailgun account',
                'Verify MAILGUN_DOMAIN environment variable is correct',
                'Check domain spelling and configuration'
              ]
            };
          } else if (testResponse.status === 403) {
            message = 'Access forbidden - Check domain permissions';
            errorDetails = {
              issue: 'Insufficient permissions for domain access',
              solutions: [
                'Verify API key has access to the domain',
                'Check domain ownership in Mailgun dashboard',
                'Ensure proper domain verification'
              ]
            };
          } else {
            message = `Mailgun API error: ${testResponse.status} ${testResponse.statusText}`;
            errorDetails = {
              issue: `HTTP ${testResponse.status} error`,
              solutions: [
                'Check Mailgun service status',
                'Verify API endpoint availability',
                'Try again in a few minutes'
              ]
            };
          }
        }

        return new Response(
          JSON.stringify({
            success: isSuccess,
            status: testResponse.status,
            statusText: testResponse.statusText,
            message,
            environment: environmentInfo,
            domainInfo: testResult,
            credentialsValid: isSuccess,
            errorDetails,
            responseBody: testResult,
            timestamp: new Date().toISOString(),
            requestId
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
        
      } catch (credTestError) {
        const errorMessage = credTestError instanceof Error ? credTestError.message : 'Unknown network error';
        
        logWithContext('ERROR', 'Network error during credential test', {
          requestId,
          error: errorMessage,
          stack: credTestError instanceof Error ? credTestError.stack : undefined
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Network error while testing credentials',
            details: errorMessage,
            environment: environmentInfo,
            troubleshooting: {
              possibleCauses: [
                'Network connectivity issues',
                'Mailgun API service unavailable',
                'Edge Function timeout',
                'DNS resolution problems'
              ],
              nextSteps: [
                'Check internet connectivity',
                'Verify Mailgun service status',
                'Try the test again in a few minutes',
                'Check Edge Function logs for more details'
              ]
            },
            timestamp: new Date().toISOString(),
            requestId
          }),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    }

    // Validate required fields for email sending
    if (!to || !subject || !text) {
      logWithContext('WARN', 'Missing required fields', {
        requestId,
        hasTo: !!to,
        hasSubject: !!subject,
        hasText: !!text
      });

      return new Response(
        JSON.stringify({ 
          error: 'Missing required fields: to, subject, and text are required',
          requestId
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check credentials
    if (!MAILGUN_API_KEY || !MAILGUN_SENDING_KEY) {
      logWithContext('ERROR', 'Missing Mailgun configuration', {
        requestId,
        environment: environmentInfo
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Mailgun configuration is incomplete. Missing API key or sending key.',
          requestId,
          environment: environmentInfo,
          suggestions: [
            'Add MAILGUN_API_KEY to Supabase project Edge Functions secrets',
            'Add MAILGUN_SENDING_KEY to Supabase project Edge Functions secrets',
            'Ensure secrets are properly saved and deployed'
          ]
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      logWithContext('WARN', 'Invalid email format', {
        requestId,
        to: to.substring(0, 10) + '...' // Partial email for privacy
      });

      return new Response(
        JSON.stringify({ 
          error: 'Invalid email address format',
          requestId
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Prepare form data for Mailgun API
    const formData = new FormData()
    formData.append('from', `Music Supplies <marketing@${MAILGUN_DOMAIN}>`)
    formData.append('to', to)
    formData.append('subject', subject)
    formData.append('text', text)
    
    if (html) {
      formData.append('html', html)
    }

    // Add tracking and other options
    if (!testMode) {
      formData.append('o:tracking', 'true')
      formData.append('o:tracking-clicks', 'true')
      formData.append('o:tracking-opens', 'true')
    }

    // Add test mode tag if applicable
    if (testMode) {
      formData.append('o:tag', 'test-email')
      formData.append('o:tag', `request-${requestId}`)
    }

    // Send email via Mailgun API
    const mailgunUrl = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`
    
    logWithContext('INFO', 'Sending email via Mailgun', {
      requestId,
      to: to.substring(0, 10) + '...',
      subject: subject.substring(0, 50) + (subject.length > 50 ? '...' : ''),
      domain: MAILGUN_DOMAIN,
      hasHtml: !!html,
      testMode
    });

    const mailgunStartTime = Date.now();
    const response = await fetch(mailgunUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}`,
      },
      body: formData,
    })
    const mailgunResponseTime = Date.now() - mailgunStartTime;

    logWithContext('INFO', 'Mailgun API response received', {
      requestId,
      status: response.status,
      responseTime: `${mailgunResponseTime}ms`,
      ok: response.ok
    });

    if (!response.ok) {
      const errorText = await response.text()
      
      // Enhanced error analysis
      let errorCategory = 'UNKNOWN';
      let suggestions: string[] = [];
      
      if (response.status === 401) {
        errorCategory = 'AUTHENTICATION_FAILED';
        suggestions = [
          'Verify MAILGUN_API_KEY is correct',
          'Check if API key has proper permissions',
          'Ensure domain is properly verified in Mailgun dashboard'
        ];
      } else if (response.status === 403) {
        errorCategory = 'FORBIDDEN';
        suggestions = [
          'Check domain ownership in Mailgun',
          'Verify sending authorization',
          'Check IP restrictions in Mailgun settings'
        ];
      } else if (response.status === 400) {
        errorCategory = 'BAD_REQUEST';
        suggestions = [
          'Verify email address format',
          'Check subject and message content',
          'Ensure all required fields are provided'
        ];
      } else if (response.status >= 500) {
        errorCategory = 'MAILGUN_SERVER_ERROR';
        suggestions = [
          'Mailgun service may be temporarily unavailable',
          'Try again in a few minutes',
          'Check Mailgun status page'
        ];
      }

      logWithContext('ERROR', 'Mailgun API error', {
        requestId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        errorCategory,
        responseTime: `${mailgunResponseTime}ms`
      });
      
      return new Response(
        JSON.stringify({ 
          error: `Mailgun API error: ${response.status} - ${errorText}`,
          requestId,
          errorCategory,
          suggestions,
          responseTime: mailgunResponseTime,
          diagnostics: diagnostics ? {
            timestamp: new Date().toISOString(),
            requestId,
            environment: environmentInfo,
            mailgunTest: {
              status: response.status,
              response: errorText,
              error: `HTTP ${response.status}: ${response.statusText}`
            }
          } : undefined
        }),
        { 
          status: response.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const result = await response.json()
    const totalResponseTime = Date.now() - startTime;
    
    logWithContext('INFO', 'Email sent successfully', {
      requestId,
      messageId: result.id,
      to: to.substring(0, 10) + '...',
      subject: subject.substring(0, 50) + (subject.length > 50 ? '...' : ''),
      totalResponseTime: `${totalResponseTime}ms`,
      mailgunResponseTime: `${mailgunResponseTime}ms`
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: result.id,
        message: 'Email sent successfully',
        requestId,
        responseTime: totalResponseTime,
        diagnostics: diagnostics ? {
          timestamp: new Date().toISOString(),
          requestId,
          environment: environmentInfo,
          mailgunTest: {
            status: response.status,
            response: result
          },
          processInfo: {
            denoVersion: Deno.version.deno,
            hostname: 'edge-function'
          }
        } : undefined
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    const totalResponseTime = Date.now() - startTime;
    
    logWithContext('ERROR', 'Unexpected error in send-mailgun-email function', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      responseTime: `${totalResponseTime}ms`
    });
    
    return new Response(
      JSON.stringify({ 
        error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        requestId,
        responseTime: totalResponseTime,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
