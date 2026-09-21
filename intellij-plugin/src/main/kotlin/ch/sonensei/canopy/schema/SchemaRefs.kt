package ch.sonensei.canopy.schema

import com.google.gson.JsonParser

/**
 * Pure helpers for the `$schema` a document names for itself. No IDE
 * classes, so they are easy to reason about (and to test) on their own.
 */
object SchemaRefs {

    /** The top-level `$schema` string of a JSON document, or null if there is none or the text is not a JSON object. */
    fun documentSchemaRef(text: String): String? = try {
        val root = JsonParser.parseString(text)
        val ref = if (root.isJsonObject) root.asJsonObject.get("\$schema") else null
        ref?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString?.trim()?.takeIf { it.isNotEmpty() }
    } catch (e: Exception) {
        null
    }

    /** `http(s)` URLs are remote: never downloaded without the user's say-so. */
    fun isRemote(ref: String): Boolean = REMOTE.containsMatchIn(ref.trim())

    /** `file:` URIs, absolute paths and Windows drive paths; everything else that is not remote is relative to the document. */
    fun isFileUri(ref: String): Boolean = ref.trim().startsWith("file:", ignoreCase = true)

    fun isAbsolutePath(ref: String): Boolean = ref.trim().let { it.startsWith("/") || WINDOWS_DRIVE.containsMatchIn(it) }

    private val REMOTE = Regex("^https?://", RegexOption.IGNORE_CASE)
    private val WINDOWS_DRIVE = Regex("^[A-Za-z]:[\\\\/]")
}
