package ch.sonensei.canopy.editor

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.callback.CefFileDialogCallback
import org.cef.handler.CefDialogHandler
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import java.util.Vector

/**
 * Answers the page's `<input type="file">` (the "Choose schema…" button)
 * with the IDE's own file chooser.
 *
 * JBCefBrowser renders off-screen by default, and in that mode Chromium
 * cannot show its native file dialog: it asks the client's
 * [CefDialogHandler] instead, and with none registered the click silently
 * does nothing.
 *
 * The handler is a [Proxy] rather than a class implementing the interface
 * because `onFileDialog`'s signature differs between platform versions
 * (2024.3 passes one list of accept filters; 2026.x adds extensions and
 * descriptions as two more lists). A compiled implementation of one form
 * fails with AbstractMethodError on the other; the proxy answers either.
 * Both forms start with (browser, mode, title, defaultFilePath, acceptFilters)
 * and end with the callback, which is all this reads.
 */
internal object FileDialogs {

    fun install(browser: JBCefBrowser, project: Project) {
        val handler = InvocationHandler { proxy, method, args ->
            when (method.name) {
                "onFileDialog" -> onFileDialog(project, args.orEmpty())
                "equals" -> proxy === args?.firstOrNull()
                "hashCode" -> System.identityHashCode(proxy)
                "toString" -> "JSON Canopy file dialog handler"
                else -> null
            }
        }
        val dialogHandler = Proxy.newProxyInstance(
            FileDialogs::class.java.classLoader,
            arrayOf(CefDialogHandler::class.java),
            handler,
        ) as CefDialogHandler
        browser.jbCefClient.addDialogHandler(dialogHandler, browser.cefBrowser)
    }

    // Returns true when we take over the dialog, false to leave it to CEF.
    private fun onFileDialog(project: Project, args: Array<out Any?>): Boolean {
        val mode = args.getOrNull(1) as? CefDialogHandler.FileDialogMode ?: return false
        val callback = args.lastOrNull() as? CefFileDialogCallback ?: return false
        if (mode != CefDialogHandler.FileDialogMode.FILE_DIALOG_OPEN &&
            mode != CefDialogHandler.FileDialogMode.FILE_DIALOG_OPEN_MULTIPLE
        ) {
            return false
        }
        val title = (args.getOrNull(2) as? String)?.takeIf { it.isNotBlank() }
        val defaultPath = (args.getOrNull(3) as? String)?.takeIf { it.isNotBlank() }
        val extensions = extensionsOf(args.getOrNull(4))
        val multiple = mode == CefDialogHandler.FileDialogMode.FILE_DIALOG_OPEN_MULTIPLE

        // Called on CEF's thread; the chooser is Swing and modal, so show it
        // on the EDT and answer the callback from there.
        ApplicationManager.getApplication().invokeLater({
            try {
                val descriptor = FileChooserDescriptor(true, false, false, false, false, multiple)
                    .withTitle(title ?: "Choose File")
                if (extensions.isNotEmpty()) {
                    descriptor.withFileFilter { it.extension?.lowercase() in extensions }
                }
                val toSelect = defaultPath?.let { LocalFileSystem.getInstance().findFileByPath(it) }
                val chosen = FileChooser.chooseFiles(descriptor, project, toSelect)
                    .mapNotNull { f -> runCatching { f.toNioPath().toString() }.getOrNull() }
                if (chosen.isEmpty()) callback.Cancel() else callback.Continue(Vector(chosen))
            } catch (e: Exception) {
                thisLogger().warn("JSON Canopy: file dialog failed", e)
                callback.Cancel()
            }
        }, ModalityState.any())
        return true
    }

    // The input's `accept` list, e.g. [".json", "application/json"]: keep
    // the extensions, and read the JSON media types as "json". Anything we
    // cannot map (another media type, "image/*") means no filtering at all,
    // rather than hiding files the page would have accepted.
    private fun extensionsOf(filters: Any?): Set<String> {
        val list = (filters as? List<*>)?.filterIsInstance<String>().orEmpty()
        val result = mutableSetOf<String>()
        for (raw in list) {
            // CEF may pass "Description|.ext1;.ext2" for some filters.
            for (part in raw.substringAfter('|').split(';').map { it.trim().lowercase() }) {
                when {
                    part.isEmpty() -> {}
                    part.startsWith(".") -> result += part.removePrefix(".")
                    part == "application/json" || part.endsWith("+json") -> result += "json"
                    else -> return emptySet()
                }
            }
        }
        return result
    }
}
