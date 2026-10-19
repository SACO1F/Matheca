import { useEffect, useRef, useState } from "react";
import {
  guideValues,
  guideVerifiedDate,
  type GuideLink,
  type GuideValue,
} from "../shared/guide";
import "./api-guide.css";

const steps = [
  {
    title: "打开 DeepSeek",
    intro:
      "先打开 DeepSeek 官网，进入 API 开放平台；也可以直接打开下方的平台入口。",
    items: [
      "用于创建密钥和充值的是 platform.deepseek.com。",
      "在浏览器中完成平台操作，再回到 Matheca 填写配置。",
    ],
    action: "打开 API 开放平台",
    link: "platform",
  },
  {
    title: "注册或登录",
    intro: "没有账号时点击注册 / Sign up；已有账号直接登录。",
    items: [
      "按页面要求填写手机号或邮箱，完成验证并设置密码。",
      "登录后进入开放平台；如平台提示实名认证，按其要求完成。",
    ],
    action: "打开注册 / 登录页面",
    link: "platform",
  },
  {
    title: "充值 API 余额",
    intro: "进入平台的余额 / 充值页面，查看可用于 API 调用的余额。",
    items: [
      "需要充值时，选择金额和页面提供的支付方式，完成支付。",
      "返回余额页面确认到账。支付方式、金额和费用以平台实际显示为准。",
      "Matheca 的识别与解题会使用该账户的 API 额度。",
    ],
    action: "打开余额 / 充值页面",
    link: "balance",
  },
  {
    title: "创建并复制 API Key",
    intro: "在 API keys 页面创建一把密钥，名称可填写 Matheca。",
    items: [
      "点击创建 API key，按提示完成创建，立即复制完整的密钥。",
      "将密钥妥善保存；若无法查看完整密钥，可重新创建。",
      "API Key 是调用凭证，不是网址，也不是登录密码。不要分享真实密钥。",
    ],
    action: "打开 API keys 页面",
    link: "keys",
  },
  {
    title: "填写接口配置",
    intro: "回到“设置与备份 → 题目识别与接口”，填写下面三项。",
    items: [
      "接口地址填写 API 地址，而非官网或开放平台登录网址。",
      "模型名填写 deepseek-flash，API Key 粘贴刚复制的完整内容。",
      "可以一键填入地址与模型名，再粘贴你自己的 API Key。",
    ],
    action: "查看官方图片输入文档",
    link: "vision",
  },
  {
    title: "保存并测试",
    intro: "先点击“保存接口配置”，再点击“测试图片识别”。",
    items: [
      "测试成功后，使用右下角加号导入图片、PDF 或截图，也可直接拖入文件。",
      "在任务页查看进度；识别完成后，到题库核对题干、标签和原图。",
      "测试也会调用接口并消耗少量 API 额度。",
    ],
    action: "查看官方常见问题",
    link: "faq",
  },
] as const;

function GuidePicture({ step }: { step: number }) {
  const box = (
    x: number,
    y: number,
    width: number,
    text: string,
    active = false,
  ) => (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height="34"
        rx="6"
        fill={active ? "#2967e9" : "#fff"}
        stroke={active ? "#2967e9" : "#dce4f1"}
      />
      <text
        x={x + 12}
        y={y + 22}
        fill={active ? "white" : "#26334b"}
        fontSize="13"
      >
        {text}
      </text>
    </g>
  );
  return (
    <figure className="guide-picture">
      <svg
        viewBox="0 0 600 280"
        role="img"
        aria-label={`${steps[step].title}操作示意图`}
      >
        <rect
          x="1"
          y="1"
          width="598"
          height="278"
          rx="10"
          fill="#fff"
          stroke="#dce4f1"
        />
        <path d="M1 42h598" stroke="#dce4f1" />
        <circle cx="18" cy="22" r="3" fill="#a6b1c4" />
        <circle cx="30" cy="22" r="3" fill="#a6b1c4" />
        <circle cx="42" cy="22" r="3" fill="#a6b1c4" />
        <text x="66" y="26" fontSize="12" fill="#60718a">
          {step > 3
            ? "Matheca · 题目识别与接口"
            : "platform.deepseek.com · 操作示意"}
        </text>
        {step === 0 && (
          <g>
            <text x="36" y="101" fontSize="26" fill="#26334b" fontWeight="600">
              DeepSeek
            </text>
            <text x="36" y="132" fontSize="14" fill="#60718a">
              从官网进入 API 开放平台
            </text>
            {box(36, 164, 204, "进入 API 开放平台", true)}
            <path
              d="M268 180h42m-8-6 8 6-8 6"
              fill="none"
              stroke="#2967e9"
              strokeWidth="2"
            />
            {box(332, 164, 214, "注册 / 登录")}
          </g>
        )}
        {step === 1 && (
          <g>
            <text x="36" y="80" fontSize="18" fill="#26334b">
              注册 / 登录
            </text>
            {box(36, 100, 330, "填写手机号或邮箱")}
            {box(36, 148, 210, "完成验证码验证")}
            {box(36, 196, 330, "设置密码 · 完成注册", true)}
            <text x="395" y="130" fontSize="13" fill="#60718a">
              已有账号
            </text>
            <text x="395" y="156" fontSize="13" fill="#2967e9">
              直接登录即可
            </text>
          </g>
        )}
        {step === 2 && (
          <g>
            <rect x="1" y="43" width="120" height="236" fill="#f7f9fd" />
            <text x="22" y="92" fill="#2967e9" fontSize="14">
              余额 / 充值
            </text>
            <text x="22" y="124" fill="#60718a" fontSize="13">
              API keys
            </text>
            <text x="148" y="85" fontSize="16" fill="#26334b">
              API 可用余额
            </text>
            <text x="148" y="113" fontSize="13" fill="#60718a">
              支付完成后，返回这里确认到账
            </text>
            {box(148, 137, 96, "充值", true)}
            {box(148, 212, 108, "选择金额")}
            <path d="M263 229h20" stroke="#60718a" />
            {box(290, 212, 108, "完成支付")}
            <path d="M405 229h20" stroke="#60718a" />
            {box(432, 212, 126, "确认余额")}
          </g>
        )}
        {step === 3 && (
          <g>
            <rect x="1" y="43" width="120" height="236" fill="#f7f9fd" />
            <text x="22" y="92" fill="#60718a" fontSize="13">
              余额 / 充值
            </text>
            <text x="22" y="124" fill="#2967e9" fontSize="14">
              API keys
            </text>
            {box(148, 64, 158, "创建 API key", true)}
            <text x="148" y="128" fill="#26334b" fontSize="13">
              名称：Matheca
            </text>
            <rect
              x="148"
              y="148"
              width="414"
              height="88"
              rx="8"
              fill="#edf3ff"
            />
            <text x="164" y="176" fontSize="14" fill="#26334b">
              sk-…（示例，不能用于调用）
            </text>
            {box(164, 190, 182, "复制完整 API Key", true)}
          </g>
        )}
        {step === 4 && (
          <g>
            <text x="28" y="93" fontSize="12" fill="#60718a">
              接口地址
            </text>
            {box(130, 70, 438, guideValues.address)}
            <text x="28" y="149" fontSize="12" fill="#60718a">
              模型名
            </text>
            {box(130, 126, 438, guideValues.model)}
            <text x="28" y="205" fontSize="12" fill="#60718a">
              API Key
            </text>
            {box(130, 182, 438, "粘贴你自己的完整 API Key")}
            <text x="130" y="252" fontSize="12" fill="#60718a">
              填写后点击“保存接口配置”
            </text>
          </g>
        )}
        {step === 5 && (
          <g>
            {box(32, 76, 166, "保存接口配置", true)}
            <path d="M213 93h36m-8-6 8 6-8 6" fill="none" stroke="#60718a" />
            {box(265, 76, 174, "测试图片识别")}
            <rect
              x="32"
              y="143"
              width="536"
              height="78"
              rx="8"
              fill="#edf7f2"
            />
            <path
              d="m52 174 7 7 14-17"
              stroke="#16845b"
              strokeWidth="2.5"
              fill="none"
            />
            <text x="85" y="181" fontSize="14" fill="#237356">
              示意：测试通过后，可以导入题目
            </text>
            <text x="32" y="249" fontSize="12" fill="#60718a">
              识别进度在“任务”中查看
            </text>
          </g>
        )}
      </svg>
      <figcaption>
        操作示意图，非平台实拍；页面与按钮以实际显示为准。
      </figcaption>
    </figure>
  );
}

export function ApiGuide({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [feedback, setFeedback] = useState("");
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
    setFeedback("");
  }, [step]);
  const link = async (key: GuideLink) => {
    try {
      await window.matheca.openGuideLink(key);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "无法打开网页");
    }
  };
  const copy = async (key: GuideValue) => {
    try {
      await window.matheca.copyGuideValue(key);
      setFeedback(key === "address" ? "接口地址已复制" : "模型名已复制");
    } catch {
      setFeedback("复制失败，请手动填写");
    }
  };
  return (
    <dialog
      ref={dialog}
      className="api-guide-dialog"
      aria-labelledby="api-guide-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="api-guide-header">
        <div>
          <h2 id="api-guide-title">DeepSeek 接口图文教学</h2>
          <p>完成配置后，即可识别题目与调用 AI 解题</p>
        </div>
        <button className="ghost" aria-label="关闭接口教学" onClick={close}>
          关闭
        </button>
      </header>
      <div className="api-guide-body">
        <nav className="api-guide-nav" aria-label="教程步骤">
          {steps.map((s, i) => (
            <button
              key={s.title}
              aria-current={i === step ? "step" : undefined}
              onClick={() => setStep(i)}
            >
              <span>{i + 1}</span>
              {s.title}
            </button>
          ))}
          <div className="guide-verified">
            官方文档核实日期
            <br />
            {guideVerifiedDate}
            <button onClick={() => void link("docs")}>查看官方文档</button>
          </div>
        </nav>
        <div className="api-guide-content" ref={content}>
          <h3>
            {step + 1}. {steps[step].title}
          </h3>
          <p className="guide-intro">{steps[step].intro}</p>
          <GuidePicture step={step} />
          <ul className="guide-directions">
            {steps[step].items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {step === 0 && (
            <button
              className="guide-text-link"
              onClick={() => void link("home")}
            >
              打开 DeepSeek 官网
            </button>
          )}
          {step === 4 && (
            <div className="guide-config">
              <div>
                <span>HTTPS 接口地址</span>
                <code>{guideValues.address}</code>
                <button onClick={() => void copy("address")}>复制地址</button>
              </div>
              <div>
                <span>模型名</span>
                <code>{guideValues.model}</code>
                <button onClick={() => void copy("model")}>复制模型名</button>
              </div>
              <div>
                <span>API Key</span>
                <p>粘贴在 DeepSeek 平台复制的完整密钥</p>
              </div>
              <button
                className="primary guide-apply"
                onClick={() => {
                  dialog.current?.close();
                  onApply();
                }}
              >
                填入地址与模型名
              </button>
              <p className="guide-config-note">
                填入后，请粘贴自己的 API Key，再保存配置。
              </p>
            </div>
          )}
          {step === 5 && (
            <div className="guide-troubleshooting">
              <h4>测试不通过时</h4>
              <dl>
                <dt>401 / 403</dt>
                <dd>检查密钥是否完整、有效，以及模型是否有调用权限。</dd>
                <dt>402 / 余额不足</dt>
                <dd>到平台查看 API 余额，充值后重新测试。</dd>
                <dt>400 / 不支持图片</dt>
                <dd>按官方视觉文档核对模型名，使用支持图片输入的模型。</dd>
                <dt>429 / 请求频繁</dt>
                <dd>检查额度，稍后重试。</dd>
                <dt>连接失败</dt>
                <dd>检查网络、接口地址和平台服务状态。</dd>
              </dl>
            </div>
          )}
          <button
            className="guide-platform-link"
            onClick={() => void link(steps[step].link)}
          >
            {steps[step].action}
            <span aria-hidden="true"> ↗</span>
          </button>
          <p className="guide-feedback" role="status">
            {feedback}
          </p>
        </div>
      </div>
      <footer className="api-guide-footer">
        <span>
          第 {step + 1} / {steps.length} 步
        </span>
        <div>
          <button disabled={!step} onClick={() => setStep(step - 1)}>
            上一步
          </button>
          {step < steps.length - 1 ? (
            <button className="primary" onClick={() => setStep(step + 1)}>
              下一步
            </button>
          ) : (
            <button className="primary" onClick={close}>
              返回设置
            </button>
          )}
        </div>
      </footer>
    </dialog>
  );
}

export function QuickHelp() {
  return (
    <section
      className="settings-card quick-help"
      aria-labelledby="quick-help-title"
    >
      <h2 id="quick-help-title">使用说明</h2>
      <ol>
        <li>
          <strong>配置接口</strong>
          <span>填写地址、模型名和 API Key，保存后测试图片识别。</span>
        </li>
        <li>
          <strong>导入题目</strong>
          <span>
            右下角加号可导入图片、PDF
            或截图，也可直接拖入窗口；在任务页查看进度。
          </span>
        </li>
        <li>
          <strong>校对题目</strong>
          <span>点击题卡，对照原图修改题干与标签，再点击“确认已校对”。</span>
        </li>
        <li>
          <strong>整理题集</strong>
          <span>
            点击“加入题集”，调整顺序和解答留白，预览后导出 PDF / Word。
          </span>
        </li>
        <li>
          <strong>删除与撤销</strong>
          <span>删除需长按约 1.2 秒；操作后可通过提示中的“撤销”恢复。</span>
        </li>
        <li>
          <strong>备份题库</strong>
          <span>
            在设置中导出完整题库 ZIP；导入 Windows 题库时，先预览再确认合并。
          </span>
        </li>
      </ol>
    </section>
  );
}
