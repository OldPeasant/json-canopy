package ch.sonensei.canopy.schema

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager

/**
 * Works out which schema applies to a document, in this order:
 *
 *  1. a local `$schema` in the file (a path relative to the file, an
 *     absolute path or a `file:` URI): explicit, cheap and deterministic;
 *  2. whatever the IDE's JSON Schema support applies, if that plugin is
 *     present (user mappings, SchemaStore, a remote `$schema` the IDE has
 *     already downloaded under its own settings);
 *  3. a remote `$schema` nobody has fetched: [SchemaResolution.NeedsConsent].
 *
 * Nothing here touches the network.
 */
class SchemaResolver(private val project: Project, private val file: VirtualFile) {

    fun resolve(documentText: String): SchemaResolution {
        val ref = SchemaRefs.documentSchemaRef(documentText)
        var localProblem: String? = null

        if (ref != null && !SchemaRefs.isRemote(ref)) {
            val target = findLocal(ref)
            if (target != null) {
                return SchemaResolution.Found(readText(target), target.name, "\$schema in the file")
            }
            localProblem = "Cannot find the schema file '$ref' referenced by \$schema."
        }

        val ide = ApplicationManager.getApplication().getService(IdeSchemaLookup::class.java)
        val fromIde = ide?.let { ReadAction.compute<IdeSchema?, RuntimeException> { it.find(project, file) } }
        if (fromIde != null) {
            val label = fromIde.presentableName?.takeIf { it.isNotBlank() }?.let { "IDE: $it" } ?: "IDE JSON Schema mapping"
            return SchemaResolution.Found(fromIde.text, fromIde.name, label)
        }

        if (ref != null && SchemaRefs.isRemote(ref)) return SchemaResolution.NeedsConsent(ref)
        return localProblem?.let { SchemaResolution.Failed(it) } ?: SchemaResolution.None
    }

    private fun findLocal(ref: String): VirtualFile? = ReadAction.compute<VirtualFile?, RuntimeException> {
        val trimmed = ref.trim()
        when {
            SchemaRefs.isFileUri(trimmed) -> VirtualFileManager.getInstance().findFileByUrl(VfsUtilCore.fixURLforIDEA(trimmed))
            SchemaRefs.isAbsolutePath(trimmed) -> LocalFileSystem.getInstance().findFileByPath(trimmed)
            else -> file.parent?.let { VfsUtilCore.findRelativeFile(trimmed, it) }
        }?.takeIf { it.isValid && !it.isDirectory }
    }

    // The text the user sees, including unsaved edits, when the schema file is open.
    private fun readText(schemaFile: VirtualFile): String = ReadAction.compute<String, RuntimeException> {
        val document: Document? = FileDocumentManager.getInstance().getCachedDocument(schemaFile)
        document?.text ?: VfsUtilCore.loadText(schemaFile)
    }
}
