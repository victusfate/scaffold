# scaffold-linter: elixir
%{
  configs: [
    %{
      name: "default",
      checks: [
        {Credo.Check.Design.AliasUsage, []},
        {Credo.Check.Refactor.CyclomaticComplexity, max_complexity: 10},
        {Credo.Check.Refactor.FunctionArity, max_arity: 4},
        {Credo.Check.Refactor.LongQuoteBlocks, []},
        {Credo.Check.Refactor.ModuleDependencies, []},
        # MaxModuleLength: 500 lines
        {Credo.Check.Readability.MaxLineLength, max_length: 120},
      ]
    }
  ]
}
# Magic numbers: not a dedicated Credo check.
# The scaffold mechanical check covers bare numeric literals for .ex/.exs files.
