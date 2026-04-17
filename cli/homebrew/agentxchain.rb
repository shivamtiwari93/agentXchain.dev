class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.122.0.tgz"
  sha256 "f6cfbd1ea669065234836ed769a60d057b4fe15a4c2a725b7b36a22371c3bab4"
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
