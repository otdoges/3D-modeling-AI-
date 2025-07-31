import { NextResponse } from "next/server"

const API_KEY = "vibecoding" // Public API key

// Rate limiting storage (in production, use Redis or database)
const requestCounts = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT = 10 // requests per minute per IP
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute in milliseconds

function getRateLimitKey(ip: string): string {
  return `rate_limit:${ip}`
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
          details: `Maximum ${RATE_LIMIT} requests per minute. Try again later.`,
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

    const body = await request.json()
    const { task_uuid } = body

    if (!task_uuid) {
      return NextResponse.json({ error: "Missing task_uuid" }, { status: 400 })
    }

    // Get download info from external API
    const response = await fetch("https://hyperhuman.deemos.com/api/v2/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task_uuid }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `Download failed: ${response.status}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()
    
    // If the response contains a file URL, fetch and return the actual file
    if (data.download_url || data.file_url || data.url) {
      const fileUrl = data.download_url || data.file_url || data.url
      
      try {
        const fileResponse = await fetch(fileUrl)
        
        if (!fileResponse.ok) {
          // If file fetch fails, return the original data with URL
          return NextResponse.json({
            ...data,
            message: "File URL provided, but direct download failed. Use the URL to download manually."
          }, {
            headers: {
              "X-RateLimit-Limit": RATE_LIMIT.toString(),
              "X-RateLimit-Remaining": rateLimit.remaining.toString(),
              "X-RateLimit-Reset": rateLimit.resetTime.toString(),
            }
          })
        }

        // Get file content and headers
        const fileContent = await fileResponse.arrayBuffer()
        const contentType = fileResponse.headers.get("content-type") || "application/octet-stream"
        const fileName = fileUrl.split("/").pop() || `model_${task_uuid}.zip`

        // Return file directly
        return new NextResponse(fileContent, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Content-Length": fileContent.byteLength.toString(),
            "X-RateLimit-Limit": RATE_LIMIT.toString(),
            "X-RateLimit-Remaining": rateLimit.remaining.toString(),
            "X-RateLimit-Reset": rateLimit.resetTime.toString(),
          },
        })
      } catch (fileError) {
        console.error("Error fetching file:", fileError)
        // Return original data if file fetch fails
        return NextResponse.json({
          ...data,
          message: "File URL provided, but direct download failed. Use the URL to download manually."
        }, {
          headers: {
            "X-RateLimit-Limit": RATE_LIMIT.toString(),
            "X-RateLimit-Remaining": rateLimit.remaining.toString(),
            "X-RateLimit-Reset": rateLimit.resetTime.toString(),
          }
        })
      }
    }

    // Return original data if no file URL found
    return NextResponse.json(data, {
      headers: {
        "X-RateLimit-Limit": RATE_LIMIT.toString(),
        "X-RateLimit-Remaining": rateLimit.remaining.toString(),
        "X-RateLimit-Reset": rateLimit.resetTime.toString(),
      }
    })
  } catch (error) {
    console.error("Error in Download API route:", error)
    return NextResponse.json({ error: "Failed to download model" }, { status: 500 })
  }
}

