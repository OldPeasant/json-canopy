package ch.sonensei.canopy.editor

import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorLocation
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.FileEditorStateLevel
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import ch.sonensei.canopy.bridge.CanopyBridge
import ch.sonensei.canopy.bridge.LoadDocumentPayload
import ch.sonensei.canopy.theme.ThemeSync
import java.awt.BorderLayout
import java.beans.PropertyChangeListener
import java.beans.PropertyChangeSupport
import java.nio.file.Files
import java.nio.file.Path
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Hosts the JSON Canopy web app (built by the Angular project one directory
 * up, bundled into this plugin's resources by the `copyWebApp` Gradle task)
 * inside a JCEF browser panel.
 *
 * Step 4 of the port (see the approved IntelliJ-plugin plan): edits made
 * through the page now write back into the real, shared [Document] via
 * [WriteCommandAction] (so they participate in undo and are visible to the
 * sibling default-editor tab), and changes made elsewhere (that sibling
 * tab, an external tool, git) push an EXTERNAL_RELOAD into the page.
 *
 * Reading/writing goes through the platform [Document], not the
 * [VirtualFile] directly (falling back to disk only if no Document exists
 * yet) — the Document is what the built-in text editor tab also edits, so
 * this is what keeps the two tabs consistent with each other, including
 * any not-yet-saved changes.
 */
class CanopyFileEditor(
    private val project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val browser: JBCefBrowser? = if (JBCefApp.isSupported()) JBCefBrowser() else null
    private val bridge: CanopyBridge? = browser?.let { CanopyBridge(it) }
    // `this` (the FileEditor) as the owning Disposable: the LafManagerListener
    // subscription this creates is torn down when the editor tab closes.
    private val themeSync: ThemeSync? = browser?.let { ThemeSync(it, this) }
    // BorderLayout.CENTER, not the raw browser.component, is what makes it
    // actually stretch to fill the tab: returned directly, it only gets its
    // own small preferred size, leaving most of the tab empty and the page
    // crammed into a tiny corner -- the established fix for this exact
    // JBCefBrowser sizing issue.
    private val component: JComponent = browser?.let { wrapFilling(it.component) } ?: unsupportedPanel()
    private val propertyChangeSupport = PropertyChangeSupport(this)

    private val document: Document? = FileDocumentManager.getInstance().getDocument(file)

    // Tracks the text we last knew about (either sent to the page, or
    // received from it) so the DocumentListener below can tell "this change
    // is our own write-back echoing back" apart from "this change came from
    // somewhere else (sibling tab, external tool)" and only forward the
    // latter as EXTERNAL_RELOAD -- without this guard, applying our own
    // DOCUMENT_CHANGED write would immediately bounce back to the page as
    // an EXTERNAL_RELOAD, which would bounce back as another
    // DOCUMENT_CHANGED, forever.
    private var lastKnownText: String? = document?.text

    private val documentListener = object : DocumentListener {
        override fun documentChanged(event: DocumentEvent) {
            val newText = event.document.text
            if (newText == lastKnownText) return
            lastKnownText = newText
            propertyChangeSupport.firePropertyChange(PROP_MODIFIED, null, null)
            bridge?.sendExternalReload(newText)
        }
    }

    init {
        bridge?.addReadyHandler { sendDocument() }
        bridge?.addDocumentChangedHandler { text -> applyIncomingEdit(text) }
        // The Disposable-scoped overload: the listener is torn down
        // automatically when `this` (the FileEditor) is disposed, so
        // there's no matching removeDocumentListener call in dispose().
        document?.addDocumentListener(documentListener, this)
        loadPage()
    }

    // The page's own URL: a real temp file, loaded as a plain file:// URL.
    private var pageFile: Path? = null

    // JBCefBrowser.loadHTML serves the page from a synthetic
    // file:///jbcefbrowser/<n> URL through a JetBrains scheme handler. On
    // some IDE/runtime combinations (seen on IntelliJ IDEA 2026.2 as a
    // Flatpak) that handler is bypassed, Chromium tries to read the
    // non-existent path itself and the tab shows "Your file couldn't be
    // accessed". Loading a real file avoids the handler; loadHTML stays as
    // the fallback if the temp file can't be written.
    private fun loadPage() {
        val html = loadHostedHtml()
        try {
            val path = Files.createTempFile("json-canopy-", ".html")
            Files.writeString(path, html)
            pageFile = path
            browser?.loadURL(path.toUri().toString())
        } catch (e: Exception) {
            browser?.loadHTML(html)
        }
    }

    private fun sendDocument() {
        val text = document?.text ?: loadFromDiskFallback()
        bridge?.sendLoadDocument(
            LoadDocumentPayload(
                fileName = file.name,
                text = text,
                readOnly = !file.isWritable,
            ),
        )
    }

    private fun loadFromDiskFallback(): String = try {
        VfsUtilCore.loadText(file)
    } catch (e: Exception) {
        "{}"
    }

    private fun applyIncomingEdit(text: String) {
        val doc = document ?: return
        if (text == doc.text) return
        // Set BEFORE writing so the DocumentListener's own firing (a direct
        // consequence of this write) sees newText == lastKnownText and
        // treats it as an echo, not an external change -- see the comment
        // on lastKnownText above.
        lastKnownText = text
        WriteCommandAction.runWriteCommandAction(project, "JSON Canopy Edit", null, {
            doc.setText(text)
        })
        propertyChangeSupport.firePropertyChange(PROP_MODIFIED, null, null)
    }

    private fun loadHostedHtml(): String {
        val raw = javaClass.classLoader.getResource("webview/index.html")
            ?.readText()
            ?: return errorHtml("JSON Canopy's bundled web app is missing from this plugin build.")

        // `window.__JSON_CANOPY_HOST__` is the flag the Angular host-bridge
        // service checks to detect it's running inside the plugin instead
        // of as a standalone page; `window.__canopySendToHost` (defined
        // by the bridge's injection script) is the function it calls to
        // talk back to Kotlin. Both need to exist before Angular's own
        // bootstrap script runs, hence injecting into <head>.
        val hostScript = bridge?.injectionScript().orEmpty()
        val withHostScript = raw.replaceFirst(
            "<head>",
            "<head>\n<script>window.__JSON_CANOPY_HOST__ = true;\n$hostScript</script>",
        )

        // Set the initial theme directly in the markup (rather than waiting
        // for the first live pushTheme() after load) so there's no visible
        // flash of the wrong theme. The bundled HTML always has this exact
        // literal attribute -- src/index.html hardcodes data-theme="dark"
        // and the build inlines it verbatim.
        val initialTheme = themeSync?.currentTheme() ?: "dark"
        return withHostScript.replaceFirst("data-theme=\"dark\"", "data-theme=\"$initialTheme\"")
    }

    private fun errorHtml(message: String): String =
        "<html><body style=\"font-family:sans-serif;padding:16px;\">$message</body></html>"

    private fun unsupportedPanel(): JComponent =
        JLabel(
            "JSON Canopy needs JCEF, which isn't available in this IDE build/runtime.",
            SwingConstants.CENTER,
        )

    private fun wrapFilling(inner: JComponent): JComponent =
        JPanel(BorderLayout()).apply { add(inner, BorderLayout.CENTER) }

    override fun getComponent(): JComponent = component

    override fun getPreferredFocusedComponent(): JComponent? = component

    override fun getName(): String = "JSON Canopy"

    override fun getFile(): VirtualFile = file

    override fun isModified(): Boolean =
        document?.let { FileDocumentManager.getInstance().isDocumentUnsaved(it) } ?: false

    override fun isValid(): Boolean = file.isValid

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {
        propertyChangeSupport.addPropertyChangeListener(listener)
    }

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {
        propertyChangeSupport.removePropertyChangeListener(listener)
    }

    override fun getCurrentLocation(): FileEditorLocation? = null

    override fun getState(level: FileEditorStateLevel): FileEditorState = EmptyFileEditorState

    override fun setState(state: FileEditorState) {}

    override fun dispose() {
        // No document.removeDocumentListener(documentListener) call here:
        // it was registered via the Disposable-scoped overload above, which
        // tears it down automatically -- calling both would risk a
        // double-removal issue rather than prevent a leak.
        bridge?.dispose()
        browser?.dispose()
        pageFile?.let { runCatching { Files.deleteIfExists(it) } }
    }

    private object EmptyFileEditorState : FileEditorState {
        override fun canBeMergedWith(otherState: FileEditorState, level: FileEditorStateLevel): Boolean = true
    }

    private companion object {
        // FileEditor exposes this as PROP_MODIFIED in some platform versions
        // and as a getPropModified() accessor in others; the string value
        // itself ("modified") is the stable, documented part of the
        // contract, so we use it directly rather than pin to either form.
        const val PROP_MODIFIED = "modified"
    }
}
