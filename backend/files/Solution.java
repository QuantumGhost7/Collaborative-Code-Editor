import java.util.Scanner;
class Solution{
  public static void main(String args[]){
    Scanner sc = new Scanner (System.in);
    int n = sc.nextInt();
    if (n >= 2) {
      for (int i = 2; i <= n / 2; ++i) {
        // condition for non-prime number
        if (n % i == 0) {
          System.out.println(n + " is not a prime number.");
          break;
        }
      } else {
        System.out.println(n + " is a prime number.");
      }
    } else {
      System.out.println(n + " is not a prime number.");
    }
  }
}