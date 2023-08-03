

export default class SharedService {

    private temp: number;
    private model: string;

    constructor(model: string, temp: number) {
        this.model = model;
        this.temp = temp;
    }

    public setTemp(temp: number): void {
        this.temp = temp;
    }

    public getTemp(): number {
        return this.temp;
    }

    public setModel(model: string): void {
        this.model = model;
    }

    public getModel(): string {
        return this.model;
    }
}