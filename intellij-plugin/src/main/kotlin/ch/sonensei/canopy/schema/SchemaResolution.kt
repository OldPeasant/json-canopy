package ch.sonensei.canopy.schema

import ch.sonensei.canopy.bridge.SchemaStatus
import ch.sonensei.canopy.bridge.SetSchemaPayload

/** The outcome of working out which schema applies to a document. */
sealed interface SchemaResolution {
    data class Found(val text: String, val name: String, val source: String) : SchemaResolution
    /** A remote `$schema` the IDE does not have; ask the user before fetching [url]. */
    data class NeedsConsent(val url: String) : SchemaResolution
    data object None : SchemaResolution
    data class Failed(val message: String) : SchemaResolution

    fun toPayload(): SetSchemaPayload = when (this) {
        is Found -> SetSchemaPayload(SchemaStatus.FOUND, name = name, source = source, text = text)
        is NeedsConsent -> SetSchemaPayload(SchemaStatus.NEEDS_CONSENT, url = url)
        None -> SetSchemaPayload(SchemaStatus.NONE)
        is Failed -> SetSchemaPayload(SchemaStatus.FAILED, message = message)
    }
}
