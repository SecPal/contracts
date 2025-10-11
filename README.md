<!--
SPDX-FileCopyrightText: 2025 SecPal Contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SecPal Contracts

OpenAPI specifications and TypeScript type definitions for the SecPal API.

## 📋 Overview

This repository contains the API contracts that define the interface between the SecPal frontend and backend services. It includes:

- **OpenAPI Specifications**: RESTful API definitions in OpenAPI 3.x format
- **TypeScript Types**: Generated TypeScript interfaces and types
- **Validation Schemas**: Request/response validation schemas
- **API Documentation**: Human-readable API documentation

## 🏗️ Structure

```
contracts/
├── openapi/           # OpenAPI specification files
│   ├── main.yaml     # Main API specification
│   └── schemas/      # Reusable schema definitions
├── src/              # TypeScript source files
│   └── types/        # Generated TypeScript types
├── docs/             # Generated API documentation
└── tests/            # Contract tests and validation
```

## 🚀 Getting Started

### Prerequisites

- Node.js 22+
- npm or yarn

### Installation

```bash
npm install
```

### Generate TypeScript Types

```bash
npm run generate
```

### Validate OpenAPI Specs

```bash
npm run validate
```

### Build

```bash
npm run build
```

## 📝 Usage

### In Frontend

```typescript
import { User, LogEntry, Shift } from "@secpal/contracts";

const user: User = {
  id: "123",
  email: "user@example.com",
  // ...
};
```

### In Backend

```typescript
import { CreateLogEntryRequest, LogEntryResponse } from "@secpal/contracts";

// Use for request/response typing
```

## 🔧 Development

### Adding New Endpoints

1. Update OpenAPI specification in `openapi/main.yaml`
2. Run `npm run generate` to update TypeScript types
3. Run `npm run validate` to ensure spec is valid
4. Create a PR with your changes

### Testing

```bash
npm test
```

## 📦 Publishing

Types are automatically published to npm when a new version tag is pushed:

```bash
npm version patch|minor|major
git push --tags
```

## 📄 License

This project is licensed under the **AGPL-3.0-or-later** license.

See [LICENSE](LICENSE) for the full license text.

## 🤝 Contributing

Please read [CONTRIBUTING.md](https://github.com/SecPal/.github/blob/main/CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 🔒 Security

For security issues, please email **security@sepal.app**. Do not create public issues for security vulnerabilities.

See [SECURITY.md](https://github.com/SecPal/.github/blob/main/SECURITY.md) for our security policy.

## 🆘 Support

- [Issue Tracker](https://github.com/SecPal/contracts/issues)
- [Support Documentation](https://github.com/SecPal/.github/blob/main/SUPPORT.md)
