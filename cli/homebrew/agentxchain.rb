class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-0.8.8.tgz"
  sha256 "90de0b8b97abda37403cf325383be6753c898c52ce2609de7bea94a09beb8582"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/agentxchain --version")
  end
end
