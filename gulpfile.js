const { task, src, dest, parallel } = require('gulp');

task('build:icons', parallel(copyNodeIcons, copyCredIcons, copyNodeCodex));

function copyNodeIcons() {
	return src('nodes/**/*.{png,svg}').pipe(dest('dist/nodes'));
}

function copyCredIcons() {
	return src('credentials/**/*.{png,svg}').pipe(dest('dist/credentials'));
}

function copyNodeCodex() {
	return src('nodes/**/*.json').pipe(dest('dist/nodes'));
}
