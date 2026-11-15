# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-15

### Added

- First version: the pipelines of Woodpecker CI 3 or later in Gladys (Gladys
  5.1.0 or later), read with a personal access token.
- One device per followed repository: status of the last pipeline, last
  pipeline passed, pipeline running, number, duration, branch and event.
- A Woodpecker CI device: server reachable, pending and running workflows, idle
  agents (admin token) and failing repositories.
- The default branch alone decides by default: a failing pull request does not
  turn a repository red (option to count every pipeline).
- Scene triggers "Woodpecker pipeline finished" and "Woodpecker repository
  failing or back to green", kept across restarts, never announced twice.
- Scene actions "Read a Woodpecker repository" and "Restart the last Woodpecker
  pipeline" (off by default).
- A "Woodpecker pipelines" dashboard widget, failing repositories first.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-woodpecker/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-woodpecker/releases/tag/v1.0.0
