import { NextResponse } from "next/server"

// Rate limiting storage (in production, use Redis or database)
const requestCounts = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT = 20 // requests per minute per IP
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute in milliseconds

function getRateLimitKey(ip: string): string {
  return `rate_limit:proxy:${ip}`
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

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    // Only allow https URLs and specific trusted domains
    return url.protocol === 'https:' && (
      url.hostname.includes('hyperhuman.deemos.com') ||
      url.hostname.includes('amazonaws.com') ||
      url.hostname.includes('cloudfront.net')
    )
  } catch {
    return false
  }
}

export async function GET(request: Request) {
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
          details: `Maximum ${RATE_LIMIT} proxy requests per minute. Try again later.`,
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

    const url = new URL(request.url)
    const fileUrl = url.searchParams.get("url")

    if (!fileUrl) {
      return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
    }

    // Validate URL for security
    if (!isValidUrl(fileUrl)) {
      return NextResponse.json({ 
        error: "Invalid or untrusted URL", 
        details: "Only HTTPS URLs from trusted domains are allowed"
      }, { status: 400 })
    }

    // Fetch the file from the original URL
    const response = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Next.js Proxy Download Service'
      }
    })

    if (!response.ok) {
      return NextResponse.json({ 
        error: `Failed to fetch file: ${response.status}` 
      }, { 
        status: response.status,
        headers: {
          "X-RateLimit-Limit": RATE_LIMIT.toString(),
          "X-RateLimit-Remaining": rateLimit.remaining.toString(),
          "X-RateLimit-Reset": rateLimit.resetTime.toString(),
        }
      })
    }

    // Get the file content and content type
    const fileContent = await response.arrayBuffer()
    const contentType = response.headers.get("content-type") || "application/octet-stream"
    const fileName = fileUrl.split("/").pop() || "download"

    // Create a new response with the file content and appropriate headers
    return new NextResponse(fileContent, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": fileContent.byteLength.toString(),
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "X-RateLimit-Limit": RATE_LIMIT.toString(),
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
        "X-RateLimit-Reset": rateLimit.resetTime.toString(),
      },
    })
  } catch (error) {
    console.error("Error in proxy download route:", error)
    return NextResponse.json({ error: "Failed to proxy download" }, { status: 500 })
  }
}

