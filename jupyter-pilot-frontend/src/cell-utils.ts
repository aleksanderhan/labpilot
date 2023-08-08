import { CodeCellModel } from '@jupyterlab/cells'


export function getCellOutput(cellModel: CodeCellModel): any {
    // Getting all the errors from the cell execution output
    const errors: Array<string> = []
    const out: Array<string> = []
    const outputs = cellModel.outputs.toJSON()
    console.log("outputs", outputs)

    outputs.forEach((output: any) => {
      let errorOutput = ""
      let traceback = ""
      let stderr = ""
  
      // Getting the stacktrace
      if (output.output_type === "error") {
        errorOutput = output.ename + ": " + output.evalue
        traceback = output.traceback.join("\n")
      } else if (output.output_type === "stream" && output.name === "stderr") {
        stderr = output.text
      }
  
      if (errorOutput !== "") {
        errors.push(errorOutput)
      }
      if (traceback !== "") {
        errors.push(traceback)
      }
      if (stderr !== "") {
        errors.push(stderr)
      }
  
      // Getting the output.
      if (output.output_type === "stream" && output.name === "stdout") {
        out.push(output.text)
      }
      if (output.output_type === "display_data" || output.output_type === "execute_result") {
        out.push(output.data["text/plain"])
      }
    });
  
    return {
      "errorText": errors.join("\n"),
      "outputText": out.join("\n")
    }
  }


  export class CodeBuffer {
    private undoBuffer: Array<string> = [];
    private redoBuffer: Array<string> = [];
  
    public getUndo(): string {
      return this.undoBuffer.pop();
    }
  
    public getRedo(): string {
      return this.redoBuffer.pop();
    }
  
    public addUndo(code: string): void {
      this.undoBuffer.push(code);
    }
  
    public addRedo(code: string): void {
      this.redoBuffer.push(code);
    }
  
    public clearRedoBuffer(): void {
      this.redoBuffer = [];
    }
  }