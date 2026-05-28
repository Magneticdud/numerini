const path = require('path');

module.exports = {
  mode: 'development',
  target: 'electron-main',
  entry: './src/main/index.ts',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist/main'),
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
  },
  externals: {
    'better-sqlite3': 'commonjs better-sqlite3',
  },
  // Use real __dirname at runtime (the dist/main/ directory)
  node: { __dirname: false, __filename: false },
};
