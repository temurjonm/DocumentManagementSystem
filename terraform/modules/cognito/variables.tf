variable "environment" {
  type = string
}

variable "callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/api/auth/callback/cognito"]
}

variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000"]
}
