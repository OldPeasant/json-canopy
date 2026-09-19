rootProject.name = "json-canopy-intellij-plugin"

plugins {
    // Lets Gradle auto-provision the JDK 17 toolchain requested in
    // build.gradle.kts even if the machine running the build has a
    // different JDK on PATH.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
