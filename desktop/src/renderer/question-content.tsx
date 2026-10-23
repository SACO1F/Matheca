import React from "react";
import katex from "katex";
import { parseMath } from "../domain/math";
import { questionContent } from "../domain/figures";
import { FigureImage } from "./figure-image";
import type { Question } from "../shared/types";

export const MathView = React.memo(function MathView({
  text,
}: {
  text: string;
}) {
  return (
    <div className="math-content">
      {parseMath(text).map((part, i) => {
        if (part.type === "text")
          return <React.Fragment key={i}>{part.value}</React.Fragment>;
        try {
          return (
            <span
              key={i}
              className={part.display ? "display-formula" : ""}
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(part.latex, {
                  displayMode: part.display,
                  trust: false,
                  throwOnError: true,
                  output: "htmlAndMathml",
                }),
              }}
            />
          );
        } catch {
          return (
            <span key={i} className="formula-error" title="公式语法需要修正">
              {part.latex}
            </span>
          );
        }
      })}
    </div>
  );
});
export const QuestionVisual = React.memo(function QuestionVisual({
  question: q,
  lazy = false,
}: {
  question: Question;
  lazy?: boolean;
}) {
  const content = questionContent(q);
  const figure = (index: number) => (
    <FigureImage
      key={index}
      src={q.figures![index]}
      index={index}
      width={q.figureWidths?.[index]}
      lazy={lazy}
    />
  );
  return (
    <div className="question-visual">
      <MathView text={content.stem || "尚未填写题干"} />
      {!!content.stemFigures.length && (
        <div className="card-figures">{content.stemFigures.map(figure)}</div>
      )}
      {!!content.options.length && (
        <div className="choice-preview">
          {content.options.map((option) => (
            <div className="choice-preview-option" key={option.label}>
              <span className="choice-label">{option.label}.</span>
              <div>
                <MathView text={option.value} />
                {option.figures.map(figure)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/** Subdued provenance shared by library, collection, picker and exchange cards. */
export function QuestionSource({ question }: { question: Question }) {
  const source =
    question.sourceLabel.trim() ||
    question.sourcePath.replace(/\\/g, "/").split("/").pop() ||
    "来源未知";
  return (
    <div className="question-source" title={`来源：${source}`}>
      来源：{source}
    </div>
  );
}
