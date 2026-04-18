class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.130.0.tgz"
  sha256 "c9b68a636e59c3a7514d1ddf141c9b31826ef1427ddaae406785b1aa991906d9"
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
