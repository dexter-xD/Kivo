# Change Log

All notable changes to this project will be documented in this file.

## [0.3.1]. 2026-04-06

### Fixed

- **Collection Data Loss**. When you edit environment variables it no longer removes requests and subfolders from the collection directory.

- **Requests Not Persisted**. New requests are now correctly saved to disk. Stay there even after you restart the app.

- **Request Not Working**. Deleting a request now properly removes its file from disk.

- **Slash Names Breaking Storage**. Collection and request names with `/` or characters are now safely changed for the filesystem while keeping the original display name.

### Changed

- **Storage Robustness**. All serde structs now use defaults stopping silent deserialization failures from corrupting state.

- **Testability**. Core storage logic is now extracted into functions and covered by 59 unit tests across normal, complex and stress scenarios.

## [0.3.0]. 2026-04-05

### Added

- **Multi-Scope Environments**. You can now manage global workspace variables and collection-specific overrides.

- **Modernized Collection Settings**. We completely redesigned the Overview, Headers and Auth pages.

- **Auth Token Visibility**. You can toggle visibility for authentication tokens.

- **Storage Folder Access**. You can now open the data directory directly from the UI.

### Changed

- **Zero-Friction Workflow**. We improved the autosave for deletions and navigation.

- **Navbar Analytics**. We refined environment chips and tooltip summaries.

### Fixed

- **Documents Storage Fallback**. We corrected the path resolution to default to your Documents folder.

- **Auth Save TypeError**. We resolved UI state-to-backend communication bugs.

## [0.2.0]. 2026-04-03

### Added

- **Hierarchical Collection Structure**. You can organize requests into collections within workspaces.

- **Setup Wizard**. We created an onboarding experience to bootstrap application configuration.

- **Sidebar Search**. You can now filter collections and requests in time.

- **Enhanced Context Menus**. We added high-performance logic for cloning, renaming and copy-pasting.

- **Native System Dialogs**. We integrated directory selection for storage paths.

### Changed

- **Name-Based Identifiers**. We created a tracking system for workspaces and collections.

### Fixed

- **"Show in Files" Integration**. We fixed the native folder reveal functionality.

- **Empty State Logic**. We improved UI prompts for workspaces and collections.

## [0.1.1]. 2026-04-02

### Added

- **Open Config Directory**. We added a button to workspaces for access to local data files.

- **Tauri Opener Plugin**. We migrated to Tauris opener plugin for better security and performance.

### Fixed

- **Query Parameter/Header Deletion**. We resolved an issue where query parameters and headers could not be fully deleted.

- **Request Initialization**. We initialized requests with empty parameter and header lists for a cleaner start.

- **GraphQL Variables Editor**. We restored the GraphQL variables editor in the request panel.

## [0.1.0]. 2026-03-31

### Added

- **Initial Release**. Kivo. An fast desktop HTTP client built with Rust and Tauri.

- **Core Features**. It includes request handling, collections, tabbed interface and built-in GraphQL support.

- **Platform Support**. It is available, for Windows and Linux (Debian).