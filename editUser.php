<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("user.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$errors = array();
$required_fields = array('username','first_name','last_name','hashed_password');



if(isset($_POST['userid'])){
	$user_id = $_POST['userid'];     
	$user = User::find_by_id($user_id);

	echo "<div id=\"registerErrorMessages\"></div>" ;
	echo "<form action=\"editUser.php\" method=\"post\" id=\"editUserForm\">" ;
	echo "<legend>Edit Role:</legend>" ;
	echo "<input type=\"hidden\" id=\"submit2\" name=\"submit\"/>";
	echo "<input type=\"hidden\" id=\"id\" name=\"id\" value=\"" . $user->id . "\"/> </br>";
	echo "First Name:<input type=\"text\" id=\"first_name\" name=\"first_name\" value=\"" . $user->first_name . "\"/> </br>";
	echo "Last Name:<input type=\"text\" id=\"last_name\" name=\"last_name\" value=\"" . $user->last_name . "\"/> </br>";
	echo "User Name:<input type=\"text\" id=\"username\" name=\"username\" value=\"" . $user->username . "\"/> </br>";
	echo "E-Mail:<input type=\"text\" id=\"email\" name=\"email\" value=\"" . $user->email . "\"/> </br>";
	echo "Password:<input type=\"password\" id=\"hashed_password\" name=\"hashed_password\" value=\"" . $user->hashed_password . "\"/> </br>";
	echo "Password Confirmation:<input type=\"password\" name=\"passwordConfirmation\" id=\"passwordConfirmation\" value=\"" . $user->passwordConfirmation . "\"/> </br>";
	echo "<input id=\"editUserSubmit\" type=\"submit\" name=\"submit\" class=\"btn btn-primary\"/>";
	echo "</form>";	

} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$un = mysql_real_escape_string(htmlspecialchars($_POST['username']));
		$pw = mysql_real_escape_string(htmlspecialchars($_POST['hashed_password']));
		$fn = mysql_real_escape_string(htmlspecialchars($_POST['first_name']));
		$ln = mysql_real_escape_string(htmlspecialchars($_POST['last_name']));
		$e = mysql_real_escape_string(htmlspecialchars($_POST['email']));


		$newUser = User::register($un, $pw, $fn, $ln, $e);
		$newUser->id = $id;
		if($newUser->save()){
			redirect_to("userListing.php");
		} else {
			die("Cannot register user. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>

<?php
include_once("footer.php");
?>

<script>
	$('#addEditUserBlock').unbind();
	$('#addEditUserBlock').on("click","#editUserSubmit", function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('7');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var username = $('form[id="editUserForm"] #username').val();
		var firstname = $('form[id="editUserForm"] #first_name').val();
		var lastname = $('form[id="editUserForm"] #last_name').val();
		var password = $('form[id="editUserForm"] #hashed_password').val();
		var passwordConfirmation = $('form[id="editUserForm"] #passwordConfirmation').val();

		if(username == ''){
			valid += '<p> Username is required. </p>';
		}

		if(firstname == ''){
			valid += '<p> A First Name is required. </p>';
		}

		if(lastname == ''){
			valid += '<p> A Last Name is required. </p>';
		}

		if(password == ''){
			valid += '<p> Password is required. </p>';
		}

		if(passwordConfirmation == ''){
			valid += '<p> Password Confirmation is required. </p>';
		}		

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
		} else {
			editFormData = $('form[id="editUserForm"]').serialize();
			alert(editFormData);
			submitUserEditData(editFormData);
		}
	});

	function submitUserEditData(formData){
		$.ajax({
			type:'POST',
			url: 'editUser.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">User modified!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("userALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">User could not be modified.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editUserForm"]')[0].reset();
			}
		});
	};
</script>