// A password <input> with an eye toggle: click it to reveal the characters.
// Drop-in for any password field — pass the same props you'd give an <input>.
import React, { useState } from "react";
import { EyeI, EyeOffI } from "./icons";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  wrapStyle?: React.CSSProperties; // styles for the wrapper (e.g. width/flex to match layout)
}

export function PasswordInput({ wrapStyle, style, className = "field", ...props }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", ...wrapStyle }}>
      <input
        {...props}
        className={className}
        type={show ? "text" : "password"}
        style={{ ...style, paddingRight: 36 }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        style={{
          position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", cursor: "pointer", padding: 2,
          display: "flex", alignItems: "center", lineHeight: 0,
        }}
      >
        {show ? <EyeOffI /> : <EyeI />}
      </button>
    </div>
  );
}
