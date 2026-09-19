package ch.sonensei.canopy.theme

import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefBrowser

/**
 * Detects the IDE's current light/dark theme and keeps an open JCEF panel's
 * `data-theme` attribute (see the `[data-theme='light'/'dark']` blocks in
 * the web app's src/styles.css) in sync with it -- both at open time
 * ([currentTheme], used to set the initial attribute before the page even
 * loads) and on every live LaF change, for as long as the [disposable]
 * passed at construction (scoped to the owning editor tab) stays alive.
 *
 * Purely attribute-driven: theming on the web side is 100% CSS-variable
 * based, so setting one attribute is the entire theme switch -- no other
 * message or JS state needs to change.
 */
class ThemeSync(private val browser: JBCefBrowser, disposable: Disposable) {

    fun currentTheme(): String = if (JBColor.isBright()) "light" else "dark"

    init {
        ApplicationManager.getApplication().messageBus.connect(disposable)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener { pushTheme() })
    }

    fun pushTheme() {
        val theme = currentTheme()
        browser.cefBrowser.executeJavaScript(
            "document.documentElement.setAttribute('data-theme', '$theme');",
            browser.cefBrowser.url,
            0,
        )
    }
}
