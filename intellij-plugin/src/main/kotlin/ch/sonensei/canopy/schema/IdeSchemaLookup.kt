package ch.sonensei.canopy.schema

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/** A schema the IDE applies to a file: its text and a name for it. */
data class IdeSchema(val text: String, val name: String, val presentableName: String?)

/**
 * What the IDE's own JSON Schema support knows about a file: user mappings,
 * the SchemaStore catalog, the file's `$schema`, with remote schemas
 * already downloaded by the IDE under its own settings.
 *
 * An interface because that support lives in the bundled JSON plugin,
 * which this plugin only uses when it is there. The implementation is
 * registered from `withJson.xml`, an optional-dependency descriptor; when
 * the JSON plugin is missing nothing is registered and callers get null.
 */
interface IdeSchemaLookup {
    fun find(project: Project, file: VirtualFile): IdeSchema?
}
