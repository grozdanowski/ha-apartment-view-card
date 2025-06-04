const path = require('path');

module.exports = {
  entry: './src/ApartmentViewCard.ts',
  output: {
    filename: 'apartment-view-card.js',
    path: path.resolve(__dirname, './'),
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
};