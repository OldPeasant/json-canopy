package ch.sonensei.canopy.bridge

/**
 * Kotlin -> JS and JS -> Kotlin message envelope. Serialized as
 * `{"type": ..., "payload": ...}` via Gson on both sides of the JCEF
 * boundary (see CanopyBridge). Keep this file as the single source of
 * truth for the wire contract — the Angular counterpart is
 * `src/app/json-explorer/services/host-bridge.service.ts`.
 */

/** Kotlin -> JS: sent once, only after RECEIVING [IncomingType.READY]. */
data class LoadDocumentPayload(
    val fileName: String?,
    val text: String,
    val readOnly: Boolean,
)

/** Kotlin -> JS: the file changed outside this editor (git checkout, the
 * sibling default-editor tab, an external tool) and the page should
 * reconcile. v1 just re-parses, per the approved plan. */
data class ExternalReloadPayload(val text: String)

/** JS -> Kotlin: a user edit made through the table UI or Raw JSON mode. */
data class DocumentChangedPayload(val text: String)

/**
 * Kotlin -> JS: what the IDE found out about the document's schema. Sent
 * after LOAD_DOCUMENT and whenever the file changes outside this editor.
 *
 *  - [SchemaStatus.FOUND]: [text] is the schema; [name] and [source] say
 *    which one and how it was found (shown on the page's schema bar).
 *  - [SchemaStatus.NEEDS_CONSENT]: the file's `$schema` is a remote [url]
 *    the IDE does not already have. The page asks the user and answers
 *    with FETCH_SCHEMA; nothing is downloaded before that.
 *  - [SchemaStatus.NONE]: no schema applies.
 *  - [SchemaStatus.FAILED]: one applies but could not be read; [message]
 *    says why.
 */
data class SetSchemaPayload(
    val status: String,
    val name: String? = null,
    val source: String? = null,
    val text: String? = null,
    val url: String? = null,
    val message: String? = null,
)

object SchemaStatus {
    const val FOUND = "found"
    const val NEEDS_CONSENT = "needsConsent"
    const val NONE = "none"
    const val FAILED = "failed"
}

/** Message types this step of the bridge actually sends/handles. SET_THEME/
 * SET_EDIT_MODE/CLIPBOARD_WRITE from the full plan are separate, later
 * milestones (theme sync, polish) with their own verification. */
object OutgoingType {
    const val LOAD_DOCUMENT = "LOAD_DOCUMENT"
    const val EXTERNAL_RELOAD = "EXTERNAL_RELOAD"
    const val SET_SCHEMA = "SET_SCHEMA"
}

object IncomingType {
    const val READY = "READY"
    const val DOCUMENT_CHANGED = "DOCUMENT_CHANGED"
    /** The user agreed to download a remote schema: payload `{"url": ...}`. */
    const val FETCH_SCHEMA = "FETCH_SCHEMA"
}
