const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const common = {
  mode: 'development',
  target: 'electron-renderer',
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
  module: {
    rules: [
      { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
};

module.exports = [
  {
    ...common,
    entry: './src/renderer/kiosk/index.tsx',
    output: { filename: 'kiosk.js', path: path.resolve(__dirname, 'dist/renderer') },
    plugins: [new HtmlWebpackPlugin({ filename: 'kiosk.html', title: 'Numerini — Kiosk' })],
  },
  {
    ...common,
    entry: './src/renderer/display/index.tsx',
    output: { filename: 'display.js', path: path.resolve(__dirname, 'dist/renderer') },
    plugins: [new HtmlWebpackPlugin({ filename: 'display.html', title: 'Numerini — Display' })],
  },
  {
    ...common,
    entry: './src/preload.ts',
    target: 'electron-preload',
    output: { filename: 'preload.js', path: path.resolve(__dirname, 'dist') },
  },
];
