package ch.sonensei.canopy.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Registers the JSON Canopy table view as an ADDITIONAL editor for .json
 * files — never a replacement for the built-in text/JSON editor, so schema
 * validation, completion and formatting stay available on their own tab,
 * and files still open normally if JCEF isn't available on this install.
 */
class CanopyFileEditorProvider : FileEditorProvider, DumbAware {

    override fun accept(project: Project, file: VirtualFile): Boolean {
        return !file.isDirectory && "json".equals(file.extension, ignoreCase = true)
    }

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        return CanopyFileEditor(project, file)
    }

    override fun getEditorTypeId(): String = "json-canopy-editor"

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.PLACE_AFTER_DEFAULT_EDITOR
}
