class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.23.0.tgz"
  sha256 "4fd49ea5f1b4468224820b5d2700d4e319f90d83dcae4089db2d8cff4eeb75f9"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/agentxchain --version")
  end
end
