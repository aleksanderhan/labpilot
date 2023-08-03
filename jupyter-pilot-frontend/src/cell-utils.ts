import { CodeCellModel } from '@jupyterlab/cells';


export default function getCellOutput(cellModel: CodeCellModel): any {
    // Getting all the errors from the cell execution output
    const errors: Array<string> = [];
    const out: Array<string> = [];
    const outputs = cellModel.outputs.toJSON();
    outputs.forEach((output: any) => {
      let errorOutput = "";
      let traceback = "";
      let stderr = "";
  
      // Getting the stacktrace
      if (output.output_type === "error") {
        errorOutput = output.ename + ": " + output.evalue;
        traceback = output.traceback.join("\n");
      } else if (output.output_type === "stream" && output.name === "stderr") {
        stderr = output.text;
      }
  
      if (errorOutput !== "") {
        errors.push(errorOutput);
      }
      if (traceback !== "") {
        errors.push(traceback);
      }
      if (stderr !== "") {
        errors.push(stderr);
      }
  
      // Getting the output.
      if (output.output_type == "stream" && output.name == "stdout") {
        out.push(output.text);
      }
    });
  
    return {
      "errorText": errors.join("\n"),
      "outputText": out.join("\n")
    }
  }