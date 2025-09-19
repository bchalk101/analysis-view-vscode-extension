import * as path from 'path';
import Mocha from 'mocha';
import * as fs from 'fs';

function findTestFiles(dir: string): string[] {
	const files: string[] = [];
	const items = fs.readdirSync(dir, { withFileTypes: true });

	for (const item of items) {
		const fullPath = path.join(dir, item.name);
		if (item.isDirectory()) {
			files.push(...findTestFiles(fullPath));
		} else if (item.name.endsWith('.test.js')) {
			files.push(fullPath);
		}
	}

	return files;
}

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((c, e) => {
		try {
			const files = findTestFiles(testsRoot);

			// Add files to the test suite
			files.forEach((f: string) => mocha.addFile(f));

			// Run the mocha test
			mocha.run((failures: number) => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
				} else {
					c();
				}
			});
		} catch (err) {
			console.error(err);
			e(err);
		}
	});
}