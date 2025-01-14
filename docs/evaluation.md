# Evaluation

Evaluations are a form of testing which helps you validate your LLM’s responses and ensure they meet your quality bar.

Firebase Genkit supports third-party evaluation tools through plugins, paired with powerful observability features which provide insight into the runtime state
of your LLM-powered applications. Genkit tooling helps you automatically extract data including inputs, outputs, and information from intermediate steps to evaluate the end-to-end quality of LLM responses as well as understand the performance of your system’s building blocks.

For example, if you have a RAG flow, Genkit will extract the set
of documents that was returned by the retriever so that you can evaluate the
quality of your retriever while it runs in the context of the flow as shown below with the Genkit faithfulness and answer relevancy metrics:

```js
import { GenkitMetric, genkitEval } from '@genkit-ai/evaluator';

export default configureGenkit({
  plugins: [
    genkitEval({
      judge: geminiPro,
      metrics: [GenkitMetric.FAITHFULNESS, GenkitMetric.ANSWER_RELEVANCY],
    }),
  ],
  // ...
});
```

Start by defining a set of inputs that you want to use as an input dataset called `testQuestions.json`. This input dataset represents the test cases you will use to generate output for evaluation.

```json
["How old is Bob?", "Where does Bob lives?", "Does Bob have any friends?"]
```

You can then use the `eval:flow` command to evaluate your flow against the test
cases provided in `testQuestions.json`.

```posix-terminal
genkit eval:flow bobQA --input testQuestions.json
```

You can then see evaluation results in the Developer UI by running:

```posix-terminal
genkit start
```

Then navigate to `localhost:4000/evaluate`.

Alternatively, you can provide an output file to inspect the output in a json file.

```posix-terminal
genkit eval:flow bobQA --input testQuestions.json --output eval-result.json
```

Note: Below you can see an example of how an LLM can help you generate the test
cases.

## Supported evaluators

### Genkit evaluators

Genkit includes a small number of native evaluators, inspired by RAGAS, to help you get started:

- Faithfulness
- Answer Relevancy
- Maliciousness

### Evaluator plugins

Genkit supports additional evaluators through plugins:

- VertexAI Rapid Evaluators via the [VertexAI Plugin](plugins/vertex-ai#evaluation).
- [LangChain Criteria Evaluation](https://python.langchain.com/docs/guides/productionization/evaluation/string/criteria_eval_chain/) via the [LangChain plugin](plugins/langchain.md).

## Advanced use

`eval:flow` is a convenient way quickly evaluate the flow, but sometimes you
might need more control over evaluation steps. This may occur if you are using a different
framework and already have some output you would like to evaluate. You can perform all
the step that `eval:flow` performs semi-manually.

You can batch run your Genkit flow and add a unique label to the run which
then will be used to extract an evaluation dataset (a set of inputs, outputs, and contexts).

Run the flow over your test inputs:

```posix-terminal
genkit flow:batchRun myRagFlow test_inputs.json --output flow_outputs.json --label customLabel
```

Extract the evaluation data:

```posix-terminal
genkit eval:extractData myRagFlow --label customLabel --output customLabel_dataset.json
```

The exported data will be output as a json file with each testCase in the following format:

```json
[
  {
    "testCaseId": string,
    "input": string,
    "output": string,
    "context": array of strings,
    "traceIds": array of strings,
  }
]
```

The data extractor will automatically locate retrievers and add the produced docs to the context array. By default, `eval:run` will run against all configured evaluators, and like `eval:flow`, results for `eval:run` will appear in the evaluation page of Developer UI, located at `localhost:4000/evaluate`.

### Custom extractors

You can also provide custom extractors to be used in `eval:extractData` and `eval:flow` commands. Custom extractors allow you to override the default extraction logic giving you more power in creating datasets and evaluating them.

To configure custom extractors, add a tools config file named `genkit-tools.conf.js` to your project root, if you don't have one already.

```posix-terminal
cd $GENKIT_PROJECT_HOME

touch genkit-tools.conf.js
```

In the tools config file, add the following code:

```js
module.exports = {
  evaluators: [
    {
      flowName: 'myFlow',
      extractors: {
        context: { outputOf: 'foo-step' },
        output: 'bar-step',
      },
    },
  ],
};
```

In this sample, you configure an extractor for `myFlow` flow. The config overrides the extractors for `context` and `output` fields, and used the default logic for the `input` field.

The specification of the evaluation extractors is as follows:

- `evaluators` field accepts an array of EvaluatorConfig objects, which are scoped by `flowName`
- `extractors` is an object that specifies the extractor overrides. The current supported keys in `extractors` are `[input, output, context]`. The acceptable value types are:
  - `string` - this should be a step name, specified as a stirng. The output of this step is extracted for this key.
  - `{ inputOf: string }` or `{ outputOf: string }` - These objects represent specific channels (input or output) of a step. For example, `{ inputOf: 'foo-step' }` would extract the input of step `foo-step` for this key.
  - `(trace) => string;` - For further flexibility, you can provide a function that accepts a Genkit trace and returns a `string`, and specify the extraction logic inside this function. Refer to `genkit/genkit-tools/common/src/types/trace.ts` for the exact TraceData schema.

Note: The extracted data for all these steps will be a JSON string. The tooling will parse this JSON string at the time of evaluation automatically. If providing a function extractor, make sure that the output is a valid JSON string. For eg: `"Hello, world!"` is not valid JSON; `"\"Hello, world!\""` is valid.

### Running on existing datasets

To run evaluation over an already extracted dataset:

```posix-terminal
genkit eval:run customLabel_dataset.json
```

To output to a different location, use the `--output` flag.

```posix-terminal
genkit eval:flow bobQA --input testQuestions.json --output customLabel_evalresult.json
```

To run on a subset of the configured evaluators, use the `--evaluators` flag and provide a comma separated list of evaluators by name:

```posix-terminal
genkit eval:run customLabel_dataset.json --evaluators=genkit/faithfulness,genkit/answer_relevancy
```

### Synthesizing test data using an LLM

Here's an example flow that uses a PDF file to generate possible questions
users might be asking about it.

```js
export const synthesizeQuestions = defineFlow(
  {
    name: 'synthesizeQuestions',
    inputSchema: z.string().describe('PDF file path'),
    outputSchema: z.array(z.string()),
  },
  async (filePath) => {
    filePath = path.resolve(filePath);
    const pdfTxt = await run('extract-text', () => extractText(filePath));

    const chunks = await run('chunk-it', async () =>
      chunk(pdfTxt, chunkingConfig)
    );

    const questions: string[] = [];
    for (var i = 0; i < chunks.length; i++) {
      const qResponse = await generate({
        model: geminiPro,
        prompt: {
          text: `Generate one question about the text below: ${chunks[i]}`,
        },
      });
      questions.push(qResponse.text());
    }
    return questions;
  }
);
```

You can then use this command to export the data into a file and use for
evaluation.

```posix-terminal
genkit flow:run synthesizeQuestions '"my_input.pdf"' --output synthesizedQuestions.json
```
