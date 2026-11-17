module.exports = {
  root: true,
  env: { node: true, jest: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    // Resolve tsconfig.json from this folder, not from wherever ESLint is started
    // (VS Code runs it from the workspace root).
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'scripts/', '.eslintrc.cjs'],
};
