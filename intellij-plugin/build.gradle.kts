import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.1.20"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "ch.sonensei.canopy"
version = "0.2.0"

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
        changeNotes.set(
            """
            <ul>
                <li>New search: Matches, Path and Context modes, a "Names only" option, match
                    highlighting and dimmed context, with a description of the active mode.</li>
                <li>Collapse and expand any object or array; Shift+click applies to all related
                    nodes.</li>
                <li>The field selector closes with Esc or a click outside.</li>
            </ul>
            """.trimIndent(),
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
