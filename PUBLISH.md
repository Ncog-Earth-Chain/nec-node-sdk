# Publishing the `necjs` npm Package

This document provides step-by-step instructions and a checklist to ensure a smooth npm publish process.

---

## 1. Checklist Before Publishing

- **package.json**
  - [x] `name`, `version`, `description`, `main`, `types`, `repository`, `author`, `license`, `keywords`, `scripts`, and dependencies are present.
- **README.md**
  - [x] Exists and provides usage, installation, and documentation.
- **Build Output**
  - [x] The `dist/` directory exists and contains all necessary build files (`index.cjs.js`, `index.esm.js`, `index.umd.js`, `index.d.ts`, etc.).
- **.npmignore or files field**
  - [x] `.npmignore` exists to control what files are published.
- **LICENSE**
  - [x] `LICENSE` file is present (MIT license).
- **Tests**
  - [ ] Ensure all tests pass:  
    ```sh
    npm test
    ```
- **Build**
  - [ ] Build the package:  
    ```sh
    npm run build
    ```
- **Authentication**
  - [ ] Log in to npm (if not already):  
    ```sh
    npm login
    ```
- **Versioning**
  - [ ] Bump the version in `package.json` if this is a new release.
- **Publish**
  - [ ] Publish the package:  
    ```sh
    npm publish
    ```

---

## 2. Example Publish Commands

```sh
# Install dependencies
npm install

# Run linter and tests
npm run lint
npm test

# Build the package
npm run build

# Log in to npm (if needed)
npm login

# Bump version if needed
npm version patch  # or minor/major

# Publish
npm publish
```

---

## 3. Notes

- The `prepublishOnly` script will automatically build and test before publishing.
- Make sure the `LICENSE` file is present in the root directory.
- The `.npmignore` file controls what is excluded from the npm package. Double-check it to ensure only necessary files are published.
- If you add new files to the build output, update `.npmignore` accordingly.

---

## 4. Troubleshooting

- If you get errors about missing files, ensure the build output is up to date.
- If you see permission errors, make sure you are logged in with the correct npm account and have access to the package name. 