pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google { content { includeGroupByRegex("androidx\\..*"); includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google\\.android.*"); includeGroupByRegex("com\\.google\\.mlkit.*"); includeGroupByRegex("com\\.google\\.firebase.*") } }
        mavenCentral()
    }
}
rootProject.name = "Matheca"
include(":app")
