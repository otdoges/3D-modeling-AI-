import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Extract common callback parameters
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Handle error cases
    if (error) {
      return NextResponse.json(
        { 
          error: error,
          error_description: errorDescription || 'Unknown error occurred'
        },
        { status: 400 }
      )
    }

    // Handle successful callback
    if (code) {
      // Process the authorization code here
      // This is where you would typically exchange the code for tokens
      
      return NextResponse.json({
        success: true,
        code: code,
        state: state,
        message: 'Callback received successfully'
      })
    }

    // No code or error provided
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    )

  } catch (error) {
    console.error("Error in callback API route:", error)
    return NextResponse.json(
      { error: "Failed to process callback" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Handle POST callback data
    const { event, data, timestamp } = body

    // Process webhook/callback data
    console.log('Callback received:', { event, data, timestamp })

    // Add your callback processing logic here
    // This could be webhook processing, status updates, etc.

    return NextResponse.json({
      success: true,
      message: 'Callback processed successfully',
      received_at: new Date().toISOString()
    })

  } catch (error) {
    console.error("Error processing POST callback:", error)
    return NextResponse.json(
      { error: "Failed to process callback data" },
      { status: 500 }
    )
  }
}