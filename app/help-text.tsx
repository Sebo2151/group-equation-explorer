/** General orientation; challenge-specific guidance stays with each challenge. */
export function HelpText() {
  return (
    <div className="help">
      <h3>What you are doing</h3>
      <p>
        You start from an expression or an equation and change it one step at a time. Every step
        has to be justified by a law that holds in every group, and the app will not let you make
        a move that is not. When a challenge sets a target, you are finished once your line
        matches it.
      </p>

      <h3>Making a step</h3>
      <p>
        Each challenge starts with a short briefing: read the target, make a prediction, and then
        choose <strong>Begin proof</strong>. You can reopen the briefing from the proof controls.
      </p>
      <ol>
        <li>No law is chosen for you. Choose one, and every place it can be used is then marked.</li>
        <li>Choose one of those places. A numbered bracket sits under the part it would rewrite.</li>
        <li>The new line joins the proof, labelled with the law that produced it.</li>
      </ol>
      <p>
        On an equation, some laws rewrite part of one side. Others act on the statement as a whole
        — multiplying both sides, or swapping them — and are offered on the line itself rather than
        under any part of it.
      </p>

      <h3>Writing an expression</h3>
      <p>
        Products are written by juxtaposition: <code>ab</code>, <code>a b</code> and <code>a*b</code>{' '}
        all mean the same thing. A generator is one letter and any digits, so <code>r2</code> is a
        single generator while <code>a^2</code> is a power. <code>e</code> is the identity. A
        repeated power needs parentheses: <code>(a^2)^3</code>. One <code>=</code> makes the line an
        equation.
      </p>

      <h3>Order matters</h3>
      <p>
        Nothing here assumes that <code>ab</code> and <code>ba</code> are the same. That is why
        multiplying an equation on the left and on the right are different moves, and why{' '}
        <code>(ab)^-1</code> is <code>b^-1 a^-1</code> rather than <code>a^-1 b^-1</code>.
      </p>

      <h3>Changing your mind</h3>
      <p>
        Undo and redo step back and forth through the proof; taking a different move after undoing
        replaces what came after. Restart returns to the first line. Nothing is timed, and a longer
        valid proof still receives full credit; step counts are only there to help you compare routes.
      </p>
    </div>
  );
}
