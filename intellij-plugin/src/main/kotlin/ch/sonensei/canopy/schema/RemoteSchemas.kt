package ch.sonensei.canopy.schema

import com.intellij.util.io.HttpRequests

/**
 * Downloads a schema the user agreed to fetch. Goes through the platform's
 * [HttpRequests], so the IDE's proxy and certificate settings apply. Blocking:
 * call it off the UI thread.
 */
object RemoteSchemas {
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 20_000

    fun fetch(url: String): SchemaResolution {
        if (!SchemaRefs.isRemote(url)) return SchemaResolution.Failed("Only http and https schemas can be downloaded: $url")
        return try {
            val text = HttpRequests.request(url)
                .connectTimeout(CONNECT_TIMEOUT_MS)
                .readTimeout(READ_TIMEOUT_MS)
                .accept("application/schema+json, application/json, */*")
                .readString(null)
            SchemaResolution.Found(text, url.substringAfterLast('/').ifBlank { url }, "downloaded from $url")
        } catch (e: Exception) {
            SchemaResolution.Failed("Could not download $url: ${e.message ?: e.javaClass.simpleName}")
        }
    }
}
