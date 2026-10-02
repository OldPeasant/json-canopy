import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.1.20"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "ch.sonensei.canopy"
// One version for the IntelliJ plugin and the VS Code extension, kept in the
// web app's package.json one directory up (the extension's build checks its
// own package.json against it).
version = Regex(""""version"\s*:\s*"([^"]+)"""")
    .find(providers.fileContents(layout.projectDirectory.file("../package.json")).asText.get())
    ?.groupValues?.get(1)
    ?: error("No version in ../package.json")

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Community is enough: FileEditorProvider, JCEF (JBCefBrowser/JBCefJSQuery),
        // VFS and the write-command-action APIs this plugin needs are all in the
        // open platform, not Ultimate-only. Bump this IDE version when JetBrains
        // stops supporting it; keep sinceBuild/untilBuild below in step.
        intellijIdea("2024.3")
        // Compile against the JSON plugin's schema service (used only when the
        // plugin is present at runtime: see withJson.xml).
        bundledPlugin("com.intellij.modules.json")
    }
}

kotlin {
    // IntelliJ Platform 2024.3 (243) requires Java 21 -- confirmed by
    // verifyPluginProjectConfiguration, which flags a mismatch here.
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

intellijPlatform {
    pluginConfiguration {
        id.set("ch.sonensei.canopy")
        name.set("JSON Canopy")
        version.set(project.version.toString())
        // From ../CHANGELOG.md, shared with the VS Code extension.
        changeNotes.set(
            providers.fileContents(layout.projectDirectory.file("../CHANGELOG.md")).asText.map(::changelogHtml),
        )

        ideaVersion {
            sinceBuild.set("243")
            // Deliberately no untilBuild: verifyPluginProjectConfiguration
            // recommends against capping compatibility for 243+ plugins, so
            // it doesn't silently stop working on IDE versions newer than
            // whatever was current when this was last built.
        }
    }

    // Signing and publishing read secrets from the environment, so nothing
    // sensitive lives in the repo. See README "Publish to the Marketplace".
    signing {
        certificateChain.set(providers.environmentVariable("CERTIFICATE_CHAIN"))
        privateKey.set(providers.environmentVariable("PRIVATE_KEY"))
        password.set(providers.environmentVariable("PRIVATE_KEY_PASSWORD"))
    }
    publishing {
        token.set(providers.environmentVariable("PUBLISH_TOKEN"))
    }
    pluginVerification {
        ides {
            recommended()
        }
    }
}

// --- Angular build wiring -------------------------------------------------
// The web app already builds to one self-contained file
// (../dist/json-canopy/browser/index.html, produced by
// `npm run build` -> `ng build && node scripts/inline-single-file.mjs`).
// We run that build here and copy its output into plugin resources, so
// `processResources` (and therefore every plugin build / runIde) always
// bundles a fresh copy of the web app.

val webAppDir = layout.projectDirectory.dir("..")
val webAppDist = webAppDir.file("dist/json-canopy/browser/index.html")
val webviewResourceDir = layout.projectDirectory.dir("src/main/resources/webview")

val buildWebApp = tasks.register<Exec>("buildWebApp") {
    workingDir = webAppDir.asFile
    commandLine("npm", "run", "build")

    // Best-effort up-to-date checking: skip the (slow) `ng build` when
    // nothing under the Angular app's own source tree changed.
    inputs.dir(webAppDir.dir("src")).withPropertyName("angularSrc")
    inputs.file(webAppDir.file("package-lock.json")).withPropertyName("packageLock")
    inputs.file(webAppDir.file("angular.json")).withPropertyName("angularJson")
    inputs.dir(webAppDir.dir("scripts")).withPropertyName("buildScripts")
    outputs.file(webAppDist).withPropertyName("builtIndexHtml")
}

val copyWebApp = tasks.register<Copy>("copyWebApp") {
    dependsOn(buildWebApp)
    from(webAppDist)
    into(webviewResourceDir)
}

tasks.processResources {
    dependsOn(copyWebApp)
}

// --- Change notes ------------------------------------------------------------
// Turns ../CHANGELOG.md into the HTML the Marketplace shows as change notes.
// Only the subset that file uses: `## <version>` headings, `- ` bullets
// (continued on indented lines), **bold** and `code`. Everything above the
// first version heading is the file's own preamble and is left out.

fun changelogHtml(markdown: String): String {
    fun inline(text: String): String = text
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
        .replace(Regex("""\*\*(.+?)\*\*"""), "<b>$1</b>")
        .replace(Regex("""`(.+?)`"""), "<code>$1</code>")

    val out = StringBuilder()
    var item: StringBuilder? = null
    var inList = false
    var started = false
    fun flushItem() {
        item?.let { out.append("<li>").append(inline(it.toString())).append("</li>\n") }
        item = null
    }
    fun closeList() {
        flushItem()
        if (inList) out.append("</ul>\n")
        inList = false
    }
    for (line in markdown.lines()) {
        when {
            line.startsWith("## ") -> {
                closeList()
                started = true
                out.append("<h4>").append(inline(line.removePrefix("## ").trim())).append("</h4>\n")
            }
            !started || line.isBlank() -> {}
            line.startsWith("- ") -> {
                flushItem()
                if (!inList) out.append("<ul>\n")
                inList = true
                item = StringBuilder(line.removePrefix("- ").trim())
            }
            line.startsWith("  ") && item != null -> item!!.append(' ').append(line.trim())
            else -> {
                closeList()
                out.append("<p>").append(inline(line.trim())).append("</p>\n")
            }
        }
    }
    closeList()
    return out.toString()
}

// Prints the generated change notes, to check them before publishing.
tasks.register("printChangeNotes") {
    val notes = providers.fileContents(layout.projectDirectory.file("../CHANGELOG.md")).asText.map(::changelogHtml)
    doLast { println(notes.get()) }
}
