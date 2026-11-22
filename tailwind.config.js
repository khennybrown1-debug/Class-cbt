// Used only by tools/build-bundle.js to produce ready-made CSS for the one-file version.
module.exports = {
  content: ['./index.html', './js/app.js'],
  theme: { extend: { fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] } } }
};
