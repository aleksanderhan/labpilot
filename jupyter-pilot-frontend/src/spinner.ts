import { Terminal } from 'xterm';


const spinners = {
	"dots": {
		"interval": 80,
		"frames": [
			"⠋",
			"⠙",
			"⠹",
			"⠸",
			"⠼",
			"⠴",
			"⠦",
			"⠧",
			"⠇",
			"⠏"
		]
	},
	"dots2": {
		"interval": 80,
		"frames": [
			"⣾",
			"⣽",
			"⣻",
			"⢿",
			"⡿",
			"⣟",
			"⣯",
			"⣷"
		]
	},
	"line": {
		"interval": 130,
		"frames": [
			"-",
			"\\",
			"|",
			"/"
		]
	},
	"arc": {
		"interval": 100,
		"frames": [
			"◜",
			"◠",
			"◝",
			"◞",
			"◡",
			"◟"
		]
	}
} as any;


const colors: { [key: string]: number[] } = {
    "yellow": [33, 89],
    "blue": [34, 89],
    "green": [32, 89],
    "cyan": [35, 89],
    "red": [31, 89],
    "magenta": [36, 89]
};

export default class Spinner {
    private timer: any = null;
    private colorTxt: any = { start: "", stop: ""};

    constructor(private term: Terminal) {}

    spin(spinnerName: string) {
		this.term.write("\x1B[?25l"); // Hide cursor
        const spin: any = spinners[spinnerName];
        const spinnerFrames: any = spin.frames;
        const spinnerTimeInterval = spin.interval;
        let index = 0;
        this.timer = setInterval(() => {
            let now = spinnerFrames[index];
            if (now == undefined) {
                index = 0;
                now = spinnerFrames[index];
            }
            this.term.write(this.colorTxt.start + now + this.colorTxt.stop);
            this.term.write('\x1b[D');
            index = index >= spinnerFrames.length ? 0 : index + 1;
        }, spinnerTimeInterval);
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.term.write(" \b");
		this.term.write("\x1B[?25h"); // Show cursor
    }

    color(colorName: string) {
        let colorNums = colors[colorName];
        this.setColor(colorNums);
        return this;
    }

    setColor(colorNums: number[]) {
        this.colorTxt.start = "\x1b[" + colorNums[0] + "m";
        this.colorTxt.stop = "\x1b[" + colorNums[1] + "m\x1b[0m";
    }
}