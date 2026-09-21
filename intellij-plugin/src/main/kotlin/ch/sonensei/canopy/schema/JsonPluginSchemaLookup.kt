package ch.sonensei.canopy.schema

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.project.IndexNotReadyException
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.jetbrains.jsonSchema.ide.JsonSchemaService

/**
 * [IdeSchemaLookup] on top of the bundled JSON plugin's schema service. Only
 * ever loaded when that plugin is present: it is registered from
 * `withJson.xml`, the descriptor of the optional dependency.
 */
class JsonPluginSchemaLookup : IdeSchemaLookup {

    override fun find(project: Project, file: VirtualFile): IdeSchema? = try {
        val service = JsonSchemaService.Impl.get(project)
        val schemaFile = service.getSchemaFilesForFile(file).firstOrNull { it.isValid && !it.isDirectory }
        schemaFile?.let {
            // The text the user sees, including unsaved edits, when the schema file is open.
            val text = FileDocumentManager.getInstance().getCachedDocument(it)?.text ?: VfsUtilCore.loadText(it)
            IdeSchema(text, it.name, service.getSchemaProvider(file)?.presentableName)
        }
    } catch (e: ProcessCanceledException) {
        throw e
    } catch (e: IndexNotReadyException) {
        // The IDE is still indexing; there is nothing to report yet.
        null
    }
}
