import { NextResponse } from "next/server"

const API_KEY = "vibecoding" // Public API key

// Rate limiting storage (in production, use Redis or database)
const requestCounts = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT = 5 // requests per minute per IP (stricter for generation)
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute in milliseconds

function getRateLimitKey(ip: string): string {
  return `rate_limit:rodin:${ip}`
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetTime: number } {
  const key = getRateLimitKey(ip)
  const now = Date.now()
  const record = requestCounts.get(key)

  if (!record || now > record.resetTime) {
    // New window or expired record
    const resetTime = now + RATE_LIMIT_WINDOW
    requestCounts.set(key, { count: 1, resetTime })
    return { allowed: true, remaining: RATE_LIMIT - 1, resetTime }
  }

  if (record.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime }
  }

  // Increment count
  record.count++
  requestCounts.set(key, record)
  return { allowed: true, remaining: RATE_LIMIT - record.count, resetTime: record.resetTime }
}

export async function POST(request: Request) {
  try {
    // Get client IP for rate limiting
    const ip = request.headers.get("x-forwarded-for") || 
               request.headers.get("x-real-ip") || 
               "unknown"

    // Check rate limit
    const rateLimit = checkRateLimit(ip)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { 
          error: "Rate limit exceeded", 
          details: `Maximum ${RATE_LIMIT} generation requests per minute. Try again later.`,
          resetTime: rateLimit.resetTime
        },
        { 
          status: 429,
          headers: {
            "X-RateLimit-Limit": RATE_LIMIT.toString(),
            "X-RateLimit-Remaining": rateLimit.remaining.toString(),
            "X-RateLimit-Reset": rateLimit.resetTime.toString(),
          }
        }
      )
    }

    // Get the form data from the request
    const formData = await request.formData()

    // Forward the request to the Hyper3D API
    const response = await fetch("https://hyperhuman.deemos.com/api/v2/rodin", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `API request failed: ${response.status}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data, {
      headers: {
        "X-RateLimit-Limit": RATE_LIMIT.toString(),
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
        "X-RateLimit-Reset": rateLimit.resetTime.toString(),
      }
    })
  } catch (error) {
    console.error("Error in Rodin API route:", error)
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 })
  }
}

