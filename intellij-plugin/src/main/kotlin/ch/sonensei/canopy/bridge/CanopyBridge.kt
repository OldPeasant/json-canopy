package ch.sonensei.canopy.bridge

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery

/**
 * The Kotlin side of the Kotlin<->JS bridge described in the plugin plan.
 * One instance per open [CanopyFileEditor] / [JBCefBrowser].
 *
 * JS -> Kotlin travels through a [JBCefJSQuery]: the page calls a global
 * function (defined by [injectionScript], embedded into the page's <head>
 * before the Angular app boots) with one JSON-encoded string argument;
 * [addReadyHandler] is invoked once that string decodes to a READY message.
 *
 * Kotlin -> JS is a plain `executeJavaScript` call into
 * `window.__canopyHost.dispatch(...)`, a function the Angular
 * host-bridge service registers on its own during bootstrap (see
 * `host-bridge.service.ts`) — independent of the JBCefJSQuery machinery
 * used for the other direction.
 */
class CanopyBridge(private val browser: JBCefBrowser) : Disposable {

    private val gson = Gson()
    private val query: JBCefJSQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)

    private var onReady: (() -> Unit)? = null
    private var onDocumentChanged: ((String) -> Unit)? = null

    init {
        query.addHandler { request ->
            handleIncoming(request)
            null
        }
    }

    fun addReadyHandler(handler: () -> Unit) {
        onReady = handler
    }

    fun addDocumentChangedHandler(handler: (String) -> Unit) {
        onDocumentChanged = handler
    }

    /**
     * JS embedded directly into the bundled index.html's <head>, alongside
     * the `window.__JSON_CANOPY_HOST__` marker — safe to call immediately
     * since [query]'s underlying plumbing doesn't depend on page-load
     * timing, only on `browser`/`query` already existing (they do, by
     * construction order in CanopyFileEditor).
     */
    fun injectionScript(): String {
        val call = query.inject("message")
        return "window.__canopySendToHost = function(message) {\n$call\n};"
    }

    fun sendLoadDocument(payload: LoadDocumentPayload) {
        send(OutgoingType.LOAD_DOCUMENT, payload)
    }

    fun sendExternalReload(text: String) {
        send(OutgoingType.EXTERNAL_RELOAD, ExternalReloadPayload(text))
    }

    private fun send(type: String, payload: Any) {
        val messageJson = gson.toJson(mapOf("type" to type, "payload" to payload))
        // Encoding the JSON text itself through Gson again yields a
        // correctly quoted/escaped JS string literal (JSON string literal
        // syntax is a subset of JS string literal syntax) -- avoids
        // hand-rolling escaping for arbitrary file content.
        val jsStringLiteral = gson.toJson(messageJson)
        browser.cefBrowser.executeJavaScript(
            "window.__canopyHost && window.__canopyHost.dispatch($jsStringLiteral);",
            browser.cefBrowser.url,
            0,
        )
    }

    private fun handleIncoming(request: String) {
        val obj = try {
            JsonParser.parseString(request).asJsonObject
        } catch (e: Exception) {
            thisLogger().warn("JSON Canopy bridge: malformed message from page: $request", e)
            return
        }
        when (obj.get("type")?.asString) {
            IncomingType.READY -> onReady?.invoke()
            IncomingType.DOCUMENT_CHANGED -> {
                val text = obj.getAsJsonObject("payload")?.get("text")?.asString
                if (text != null) onDocumentChanged?.invoke(text)
            }
            else -> thisLogger().warn("JSON Canopy bridge: unhandled message type in $request")
        }
    }

    override fun dispose() {
        query.dispose()
    }
}
